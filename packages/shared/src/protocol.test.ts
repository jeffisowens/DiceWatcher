import { describe, expect, it } from "vitest";
import {
  fulfillmentMatchesRequest,
  parseProtocolMessage,
  type RollFulfillment,
  type RollRequest
} from "./protocol";

const request: RollRequest = {
  v: 1,
  type: "roll-request",
  requestId: "r1",
  dice: [{ kind: "d6", count: 2 }]
};

const die = (value: number) => ({
  kind: "d6" as const,
  value,
  confidence: 0.9,
  corrected: false
});

const fulfillment = (values: number[], requestId = "r1"): RollFulfillment => ({
  v: 1,
  type: "roll-fulfillment",
  requestId,
  dice: values.map(die)
});

describe("parseProtocolMessage", () => {
  it("parses each message type", () => {
    expect(parseProtocolMessage(request)?.type).toBe("roll-request");
    expect(parseProtocolMessage(fulfillment([3, 5]))?.type).toBe(
      "roll-fulfillment"
    );
    expect(
      parseProtocolMessage({
        v: 1,
        type: "pair-hello",
        secret: "0123456789abcdef",
        client: "camera-web"
      })?.type
    ).toBe("pair-hello");
    expect(
      parseProtocolMessage({
        v: 1,
        type: "pair-ack",
        userId: "u1",
        userName: "Jo"
      })?.type
    ).toBe("pair-ack");
  });

  it("rejects an unknown protocol version", () => {
    expect(parseProtocolMessage({ ...request, v: 2 })).toBeNull();
  });

  it("rejects out-of-range die values", () => {
    expect(parseProtocolMessage(fulfillment([0, 3]))).toBeNull();
    expect(parseProtocolMessage(fulfillment([7, 3]))).toBeNull();
  });

  it("rejects a short pairing secret", () => {
    expect(
      parseProtocolMessage({
        v: 1,
        type: "pair-hello",
        secret: "short",
        client: "camera-web"
      })
    ).toBeNull();
  });

  it("rejects a request for zero dice", () => {
    expect(
      parseProtocolMessage({ ...request, dice: [{ kind: "d6", count: 0 }] })
    ).toBeNull();
  });
});

describe("fulfillmentMatchesRequest", () => {
  it("accepts the requested number of dice", () => {
    expect(fulfillmentMatchesRequest(request, fulfillment([1, 6]))).toBe(true);
  });

  it("rejects too few or too many dice", () => {
    expect(fulfillmentMatchesRequest(request, fulfillment([1]))).toBe(false);
    expect(fulfillmentMatchesRequest(request, fulfillment([1, 2, 3]))).toBe(
      false
    );
  });

  it("rejects a different request id", () => {
    expect(fulfillmentMatchesRequest(request, fulfillment([1, 2], "r2"))).toBe(
      false
    );
  });

  it("sums counts across repeated terms of the same kind", () => {
    const split: RollRequest = {
      ...request,
      dice: [
        { kind: "d6", count: 1 },
        { kind: "d6", count: 2 }
      ]
    };
    expect(fulfillmentMatchesRequest(split, fulfillment([1, 2, 3]))).toBe(true);
  });
});

describe("closed and rejected messages", () => {
  it("parses roll-closed and roll-rejected", () => {
    expect(
      parseProtocolMessage({
        v: 1,
        type: "roll-closed",
        requestId: "r1",
        outcome: "fulfilled"
      })?.type
    ).toBe("roll-closed");
    expect(
      parseProtocolMessage({
        v: 1,
        type: "roll-rejected",
        requestId: "r1",
        reason: "Wrong number of dice."
      })?.type
    ).toBe("roll-rejected");
  });

  it("rejects an unknown close outcome", () => {
    expect(
      parseProtocolMessage({
        v: 1,
        type: "roll-closed",
        requestId: "r1",
        outcome: "lost"
      })
    ).toBeNull();
  });
});
