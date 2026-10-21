import {
  buildPairingUrl,
  checkPairHello,
  createPairingTicket,
  generateSecret,
  type PairingTicket,
  PROTOCOL_VERSION,
  type ProtocolMessage,
  parseProtocolMessage,
  type SignalingServer,
  secretsMatch
} from "@dicewatcher/shared";
import Peer, { type DataConnection } from "peerjs";

// Owns the camera link on the Foundry side: the PeerJS peer the phone dials,
// or the popup window for a same-device webcam. Knows nothing about Foundry
// so it can be exercised outside it.

const HELLO_TIMEOUT_MS = 10_000;
const POPUP_POLL_MS = 1000;
// The camera pings every few seconds; a peer link silent this long is dead
// even if WebRTC has not noticed yet (e.g. a phone that went to sleep).
const LINK_TIMEOUT_MS = 15_000;
const SIGNALING_RETRY_MS = 5000;
const END_GRACE_MS = 500;

export type Transport = "peer" | "window";

export type HostState =
  | { kind: "idle"; error?: string }
  | { kind: "starting"; transport: Transport }
  | {
      kind: "waiting";
      transport: Transport;
      pairingUrl: string;
      expiresAt: number;
    }
  | { kind: "paired"; transport: Transport };

export type PairingHostOptions = {
  webAppUrl: string;
  signaling?: SignalingServer;
  user: { id: string; name: string };
  onState(state: HostState): void;
  onMessage(message: ProtocolMessage): void;
  log?(message: string, context?: unknown): void;
};

type ActiveLink = {
  transport: Transport;
  send(message: ProtocolMessage): void;
  close(): void;
  lastSeen: number;
};

export class PairingHost {
  #options: PairingHostOptions;
  #state: HostState = { kind: "idle" };
  #ticket: PairingTicket | null = null;
  #peer: Peer | null = null;
  #link: ActiveLink | null = null;
  #popup: Window | null = null;
  #popupTimer: ReturnType<typeof setInterval> | null = null;
  // Issued to the paired camera so it can reconnect without a new QR code.
  // Lives until Disconnect, a fresh pairing, or this page closes.
  #resumeToken: string | null = null;

  constructor(options: PairingHostOptions) {
    this.#options = options;
    window.addEventListener("message", (event) => this.#onWindowMessage(event));
    setInterval(() => this.#checkLiveness(), LINK_TIMEOUT_MS / 3);
  }

  get state(): HostState {
    return this.#state;
  }

  get paired(): boolean {
    return this.#link !== null;
  }

  send(message: ProtocolMessage): boolean {
    if (!this.#link) {
      return false;
    }

    this.#link.send(message);

    return true;
  }

  // Shows a fresh QR link for a phone. Reuses the peer if it is still open.
  async startPeerPairing(): Promise<void> {
    this.#setState({ kind: "starting", transport: "peer" });

    let peerId: string;

    try {
      peerId = await this.#ensurePeer();
    } catch (error) {
      this.#setState({
        kind: "idle",
        error: `Could not reach the pairing server: ${describeError(error)}`
      });
      return;
    }

    const ticket = this.#newTicket();

    this.#setState({
      kind: "waiting",
      transport: "peer",
      expiresAt: ticket.expiresAt,
      pairingUrl: buildPairingUrl(this.#options.webAppUrl, {
        transport: "peer",
        peerId,
        secret: ticket.secret,
        ...(this.#options.signaling
          ? { signaling: this.#options.signaling }
          : {})
      })
    });
  }

  // Opens the camera app in a popup on this computer.
  startWindowPairing(): void {
    const ticket = this.#newTicket();
    const pairingUrl = buildPairingUrl(this.#options.webAppUrl, {
      transport: "window",
      secret: ticket.secret,
      foundryOrigin: window.location.origin
    });

    this.#popup = window.open(
      pairingUrl,
      "dicewatcher-camera",
      "popup=yes,width=520,height=900,resizable=yes,scrollbars=yes"
    );

    if (!this.#popup) {
      this.#ticket = null;
      this.#setState({
        kind: "idle",
        error: "The browser blocked the camera popup."
      });
      return;
    }

    this.#watchPopup();
    this.#setState({
      kind: "waiting",
      transport: "window",
      pairingUrl,
      expiresAt: ticket.expiresAt
    });
  }

  disconnect(): void {
    const link = this.#link;
    const peer = this.#peer;

    this.#ticket = null;
    this.#resumeToken = null;
    this.#link = null;
    this.#peer = null;

    if (link) {
      endLink(link);
    }

    // Give the pair-end message time to leave before the peer goes.
    setTimeout(() => peer?.destroy(), END_GRACE_MS);
    this.#setState({ kind: "idle" });
  }

  #newTicket(): PairingTicket {
    this.#ticket = createPairingTicket(Date.now());

    return this.#ticket;
  }

  // The peer stays up after pairing so its data channel survives. If it lost
  // the signaling server since (which does not drop an open channel), it
  // reconnects only when a new phone needs to find it.
  async #ensurePeer(): Promise<string> {
    const existing = this.#peer;

    if (existing && !existing.destroyed) {
      if (existing.open) {
        return existing.id;
      }

      if (existing.disconnected) {
        existing.reconnect();
        return waitForOpen(existing);
      }
    }

    const { signaling } = this.#options;
    const peer = new Peer(`dicewatcher-${generateSecret(10)}`, {
      ...(signaling ?? {}),
      debug: 1
    });

    this.#peer = peer;
    peer.on("connection", (connection) => this.#onPeerConnection(connection));
    peer.on("disconnected", () => {
      // Losing the signaling server leaves open links up but stops a dropped
      // camera from finding us again, so keep trying to get back.
      setTimeout(() => {
        if (peer.open || peer.destroyed || this.#peer !== peer) return;
        peer.reconnect();
      }, SIGNALING_RETRY_MS);
    });

    try {
      const id = await waitForOpen(peer);

      peer.on("error", (error) => {
        this.#options.log?.("[DiceWatcher] Peer error.", error);
      });

      return id;
    } catch (error) {
      peer.destroy();
      this.#peer = null;
      throw error;
    }
  }

  #onPeerConnection(connection: DataConnection) {
    const timeout = setTimeout(() => connection.close(), HELLO_TIMEOUT_MS);
    const link: ActiveLink = {
      transport: "peer",
      send: (outgoing) => {
        void connection.send(outgoing);
      },
      close: () => connection.close(),
      lastSeen: Date.now()
    };
    let accepted = false;

    connection.on("data", (data) => {
      const message = parseProtocolMessage(data);

      if (!accepted) {
        clearTimeout(timeout);

        if (!message || !this.#accept(message, "peer")) {
          connection.close();
          return;
        }

        accepted = true;
        this.#replaceLink(link);
        return;
      }

      if (message) {
        this.#receive(link, message);
      }
    });

    connection.on("close", () => {
      clearTimeout(timeout);
      this.#dropLink(link);
    });
  }

  #onWindowMessage(event: MessageEvent) {
    if (!this.#popup || event.source !== this.#popup) {
      return;
    }

    if (event.origin !== new URL(this.#options.webAppUrl).origin) {
      this.#options.log?.(
        `[DiceWatcher] Ignored a message from ${event.origin}.`
      );
      return;
    }

    const message = parseProtocolMessage(event.data);

    if (!message) {
      return;
    }

    // A hello always goes through pairing, so a reloaded popup can resume.
    if (this.#link?.transport !== "window" || message.type === "pair-hello") {
      if (this.#accept(message, "window")) {
        const popup = this.#popup;
        const origin = event.origin;

        this.#replaceLink({
          transport: "window",
          send: (outgoing) => popup.postMessage(outgoing, origin),
          close: () => popup.close(),
          lastSeen: Date.now()
        });
      }
      return;
    }

    this.#receive(this.#link, message);
  }

  #receive(link: ActiveLink, message: ProtocolMessage) {
    link.lastSeen = Date.now();

    if (message.type === "ping") {
      link.send({ v: PROTOCOL_VERSION, type: "pong" });
    }

    this.#options.onMessage(message);
  }

  #checkLiveness() {
    const link = this.#link;

    if (
      link?.transport === "peer" &&
      Date.now() - link.lastSeen > LINK_TIMEOUT_MS
    ) {
      this.#options.log?.("[DiceWatcher] Camera stopped answering.");
      link.close();
      this.#dropLink(link);
    }
  }

  // Checks the first message from a camera. Only a pair-hello carrying the
  // live, unused secret from the QR code, or the paired camera's resume
  // token, is accepted.
  #accept(message: ProtocolMessage, transport: Transport): boolean {
    if (message.type !== "pair-hello") {
      return false;
    }

    if (this.#resumeToken && secretsMatch(this.#resumeToken, message.secret)) {
      this.#options.log?.(`[DiceWatcher] Camera reconnected (${transport}).`);
      return true;
    }

    const ticket = this.#ticket;
    const verdict = ticket
      ? checkPairHello(ticket, message, Date.now())
      : "expired";

    if (!ticket || verdict !== "accepted") {
      this.#options.log?.(`[DiceWatcher] Refused ${transport} pairing.`, {
        verdict
      });
      return false;
    }

    ticket.used = true;
    this.#ticket = null;
    this.#resumeToken = generateSecret();

    return true;
  }

  #replaceLink(link: ActiveLink) {
    const previous = this.#link;

    this.#link = link;

    // A window link replacing a window link is the same popup, reloaded.
    if (
      previous &&
      !(previous.transport === "window" && link.transport === "window")
    ) {
      endLink(previous);
    }

    link.send({
      v: PROTOCOL_VERSION,
      type: "pair-ack",
      userId: this.#options.user.id,
      userName: this.#options.user.name,
      resumeToken: this.#resumeToken ?? ""
    });
    this.#setState({ kind: "paired", transport: link.transport });
  }

  #dropLink(link: ActiveLink) {
    if (this.#link !== link) {
      return;
    }

    this.#link = null;
    this.#setState({
      kind: "idle",
      error: this.#resumeToken
        ? "Lost the camera. It reconnects by itself while its page is open."
        : "The camera disconnected."
    });
  }

  #watchPopup() {
    if (this.#popupTimer) {
      clearInterval(this.#popupTimer);
    }

    this.#popupTimer = setInterval(() => {
      if (!this.#popup?.closed) {
        return;
      }

      if (this.#popupTimer) {
        clearInterval(this.#popupTimer);
      }

      this.#popupTimer = null;
      this.#popup = null;

      if (this.#link?.transport === "window") {
        this.#dropLink(this.#link);
      } else if (
        this.#state.kind === "waiting" &&
        this.#state.transport === "window"
      ) {
        this.#ticket = null;
        this.#setState({ kind: "idle" });
      }
    }, POPUP_POLL_MS);
  }

  #setState(state: HostState) {
    this.#state = state;
    this.#options.onState(state);
  }
}

// Tells a camera its pairing is over, then closes the link once the message
// has had time to arrive.
function endLink(link: ActiveLink) {
  link.send({ v: PROTOCOL_VERSION, type: "pair-end" });
  setTimeout(() => link.close(), END_GRACE_MS);
}

function waitForOpen(peer: Peer): Promise<string> {
  return new Promise((resolve, reject) => {
    const onOpen = (id: string) => {
      peer.off("error", onError);
      resolve(id);
    };
    const onError = (error: Error) => {
      peer.off("open", onOpen);
      reject(error);
    };

    peer.once("open", onOpen);
    peer.once("error", onError);
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
