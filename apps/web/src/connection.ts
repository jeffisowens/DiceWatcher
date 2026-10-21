import {
  type PairAck,
  type PairingLink,
  PROTOCOL_VERSION,
  type ProtocolMessage,
  parseProtocolMessage
} from "@dicewatcher/shared";
import Peer, { type DataConnection } from "peerjs";

// The camera's side of the link to Foundry: dials the Foundry peer from the
// QR link (or talks to the opener window), proves the pairing secret, then
// delivers validated protocol messages.

const PAIR_TIMEOUT_MS = 20_000;

export type CameraLink = {
  ack: PairAck;
  send(message: ProtocolMessage): void;
  close(): void;
};

export type LinkHandlers = {
  onMessage(message: ProtocolMessage): void;
  onClose(): void;
};

// Why connect() failed. `refused` means Foundry answered and said no (the
// code or resume token is not valid), so retrying will not help.
export class PairingError extends Error {
  readonly refused: boolean;

  constructor(message: string, refused = false) {
    super(message);
    this.refused = refused;
  }
}

type RawLink = {
  send(message: ProtocolMessage): void;
  close(): void;
};

export function connect(
  link: PairingLink,
  handlers: LinkHandlers
): Promise<CameraLink> {
  return new Promise((resolve, reject) => {
    let ack: PairAck | null = null;
    let raw: RawLink | null = null;
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      raw?.close();
      reject(error);
    };

    const timer = setTimeout(
      () => fail(new PairingError("Foundry did not answer.")),
      PAIR_TIMEOUT_MS
    );

    const onData = (data: unknown) => {
      const message = parseProtocolMessage(data);

      if (!message) return;

      if (!ack) {
        if (message.type !== "pair-ack" || !raw) return;
        ack = message;
        settled = true;
        clearTimeout(timer);
        resolve({ ack, send: raw.send, close: raw.close });
        return;
      }

      handlers.onMessage(message);
    };

    const onClose = () => {
      if (ack) {
        handlers.onClose();
      } else {
        fail(
          new PairingError(
            "Foundry refused the pairing. Scan a fresh code.",
            true
          )
        );
      }
    };

    const hello: ProtocolMessage = {
      v: PROTOCOL_VERSION,
      type: "pair-hello",
      secret: link.secret,
      client: "camera-web"
    };

    try {
      raw =
        link.transport === "peer"
          ? dialPeer(link, hello, onData, onClose, fail)
          : openerLink(link.foundryOrigin, hello, onData, onClose);
    } catch (error) {
      fail(
        error instanceof PairingError ? error : new PairingError(String(error))
      );
    }
  });
}

function dialPeer(
  link: Extract<PairingLink, { transport: "peer" }>,
  hello: ProtocolMessage,
  onData: (data: unknown) => void,
  onClose: () => void,
  fail: (error: Error) => void
): RawLink {
  const peer = new Peer({ ...(link.signaling ?? {}), debug: 1 });
  let connection: DataConnection | null = null;

  peer.on("error", (error) =>
    fail(new PairingError(`Could not reach Foundry: ${error.message}`))
  );
  peer.on("open", () => {
    const dialed = peer.connect(link.peerId, {
      reliable: true,
      serialization: "json"
    });

    connection = dialed;
    dialed.on("open", () => {
      void dialed.send(hello);
    });
    dialed.on("data", onData);
    dialed.on("close", onClose);
    dialed.on("error", (error) => fail(new PairingError(error.message)));
  });

  return {
    send: (message) => {
      void connection?.send(message);
    },
    close: () => peer.destroy()
  };
}

function openerLink(
  foundryOrigin: string,
  hello: ProtocolMessage,
  onData: (data: unknown) => void,
  onClose: () => void
): RawLink {
  const opener = window.opener as Window | null;

  if (!opener) {
    throw new PairingError(
      "This page was not opened from Foundry. Use the DiceWatcher panel there.",
      true
    );
  }

  const listener = (event: MessageEvent) => {
    if (event.source === opener && event.origin === foundryOrigin) {
      onData(event.data);
    }
  };
  const closedTimer = setInterval(() => {
    if (opener.closed) {
      clearInterval(closedTimer);
      window.removeEventListener("message", listener);
      onClose();
    }
  }, 1000);

  window.addEventListener("message", listener);
  opener.postMessage(hello, foundryOrigin);

  return {
    send: (message) => opener.postMessage(message, foundryOrigin),
    close: () => {
      clearInterval(closedTimer);
      window.removeEventListener("message", listener);
    }
  };
}
