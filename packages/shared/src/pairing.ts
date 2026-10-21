import type { PairHello } from "./protocol";

// Pairing links and one-time secrets (spec §3.2, §7). The link lives in the
// URL fragment so the secret is never sent to the web app's host.

// A secret that has not been used to pair expires after this long.
export const PAIRING_TTL_MS = 5 * 60_000;

// A PeerJS signaling server. Omitted from a link when the default
// (PeerJS cloud) is used.
export type SignalingServer = {
  host: string;
  port: number;
  path: string;
  secure: boolean;
};

export type PairingLink =
  | {
      transport: "peer";
      peerId: string;
      secret: string;
      signaling?: SignalingServer;
    }
  | {
      // Same-device webcam: the camera app runs in a popup opened by Foundry.
      transport: "window";
      secret: string;
      foundryOrigin: string;
    };

export function generateSecret(bytes = 16): string {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);

  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

export function formatSignalingServer(server: SignalingServer): string {
  const scheme = server.secure ? "https" : "http";

  return `${scheme}://${server.host}:${server.port}${server.path}`;
}

export function parseSignalingServer(value: string): SignalingServer | null {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  const secure = url.protocol === "https:";

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : secure ? 443 : 80,
    path: url.pathname || "/",
    secure
  };
}

export function buildPairingUrl(webAppUrl: string, link: PairingLink): string {
  const url = new URL(webAppUrl);
  const params = new URLSearchParams();

  params.set("t", link.transport);
  params.set("secret", link.secret);

  if (link.transport === "peer") {
    params.set("peer", link.peerId);

    if (link.signaling) {
      params.set("signal", formatSignalingServer(link.signaling));
    }
  } else {
    params.set("origin", link.foundryOrigin);
  }

  url.hash = params.toString();

  return url.toString();
}

export function parsePairingLink(hash: string): PairingLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const secret = params.get("secret");

  if (!secret) {
    return null;
  }

  switch (params.get("t")) {
    case "peer": {
      const peerId = params.get("peer");

      if (!peerId) {
        return null;
      }

      const signalParam = params.get("signal");
      const signaling = signalParam ? parseSignalingServer(signalParam) : null;

      if (signalParam && !signaling) {
        return null;
      }

      return {
        transport: "peer",
        peerId,
        secret,
        ...(signaling ? { signaling } : {})
      };
    }
    case "window": {
      const foundryOrigin = params.get("origin");

      return foundryOrigin
        ? { transport: "window", secret, foundryOrigin }
        : null;
    }
    default:
      return null;
  }
}

export type PairingTicket = {
  secret: string;
  expiresAt: number;
  used: boolean;
};

export function createPairingTicket(
  now: number,
  ttlMs = PAIRING_TTL_MS
): PairingTicket {
  return { secret: generateSecret(), expiresAt: now + ttlMs, used: false };
}

export type HelloVerdict = "accepted" | "expired" | "used" | "wrong-secret";

// Checks a camera's hello against the current ticket. The caller marks the
// ticket used when it accepts, so a secret pairs exactly one camera.
export function checkPairHello(
  ticket: PairingTicket,
  hello: PairHello,
  now: number
): HelloVerdict {
  if (!secretsMatch(ticket.secret, hello.secret)) {
    return "wrong-secret";
  }

  if (ticket.used) {
    return "used";
  }

  return now > ticket.expiresAt ? "expired" : "accepted";
}

// Compares secrets without leaking how many leading characters match.
export function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;

  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return diff === 0;
}
