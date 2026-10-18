import { describe, expect, it } from "vitest";
import {
  buildPairingUrl,
  checkPairHello,
  createPairingTicket,
  generateSecret,
  PAIRING_TTL_MS,
  parsePairingLink
} from "./pairing";
import type { PairHello } from "./protocol";

const hello = (secret: string): PairHello => ({
  v: 1,
  type: "pair-hello",
  secret,
  client: "camera-web"
});

describe("generateSecret", () => {
  it("returns 32 hex characters by default and differs each call", () => {
    const a = generateSecret();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(generateSecret()).not.toBe(a);
  });
});

describe("pairing links", () => {
  it("round-trips a peer link through the URL fragment", () => {
    const url = buildPairingUrl("https://example.github.io/DiceWatcher/", {
      transport: "peer",
      peerId: "dicewatcher-abc",
      secret: "s".repeat(32)
    });
    const parsed = new URL(url);

    expect(parsed.pathname).toBe("/DiceWatcher/");
    expect(parsed.search).toBe("");
    expect(parsePairingLink(parsed.hash)).toEqual({
      transport: "peer",
      peerId: "dicewatcher-abc",
      secret: "s".repeat(32)
    });
  });

  it("round-trips a custom signaling server", () => {
    const signaling = {
      host: "signal.example.com",
      port: 9000,
      path: "/peer",
      secure: true
    };
    const url = buildPairingUrl("https://example.com/", {
      transport: "peer",
      peerId: "p",
      secret: "x".repeat(32),
      signaling
    });

    expect(parsePairingLink(new URL(url).hash)).toMatchObject({ signaling });
  });

  it("round-trips a same-device window link", () => {
    const url = buildPairingUrl("https://example.com/", {
      transport: "window",
      secret: "x".repeat(32),
      foundryOrigin: "http://localhost:30000"
    });

    expect(parsePairingLink(new URL(url).hash)).toEqual({
      transport: "window",
      secret: "x".repeat(32),
      foundryOrigin: "http://localhost:30000"
    });
  });

  it("rejects incomplete links", () => {
    expect(parsePairingLink("")).toBeNull();
    expect(parsePairingLink("#t=peer&secret=abc")).toBeNull();
    expect(parsePairingLink("#t=window&secret=abc")).toBeNull();
    expect(parsePairingLink("#t=other&secret=abc&peer=p")).toBeNull();
    expect(
      parsePairingLink("#t=peer&secret=abc&peer=p&signal=ftp://x")
    ).toBeNull();
  });
});

describe("checkPairHello", () => {
  it("accepts the right secret before expiry", () => {
    const ticket = createPairingTicket(1000);
    expect(checkPairHello(ticket, hello(ticket.secret), 1000)).toBe("accepted");
  });

  it("rejects a wrong secret", () => {
    const ticket = createPairingTicket(1000);
    expect(checkPairHello(ticket, hello("0".repeat(32)), 1000)).toBe(
      "wrong-secret"
    );
  });

  it("rejects an expired or used secret", () => {
    const ticket = createPairingTicket(1000);
    expect(
      checkPairHello(ticket, hello(ticket.secret), 1001 + PAIRING_TTL_MS)
    ).toBe("expired");
    expect(
      checkPairHello({ ...ticket, used: true }, hello(ticket.secret), 1000)
    ).toBe("used");
  });
});
