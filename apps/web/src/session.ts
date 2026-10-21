import {
  type PairingLink,
  PROTOCOL_VERSION,
  type ProtocolMessage
} from "@dicewatcher/shared";
import { type CameraLink, connect, PairingError } from "./connection";

// Keeps the camera's link to Foundry alive across a phone that sleeps or
// switches apps: pings Foundry (which resends anything missed), notices when
// Foundry goes quiet, and reconnects with the resume token instead of a new
// QR code. The token survives a page reload for the life of the tab.

const PING_MS = 4000;
const SILENCE_MS = 12_000;
const RETRY_MS = 3000;
const GIVE_UP_MS = 3 * 60_000;
const STORAGE_KEY = "dicewatcher.resume";

export type SessionStatus =
  | { kind: "connecting" }
  | { kind: "paired"; userName: string }
  | { kind: "reconnecting" }
  | { kind: "ended"; message: string };

export type SessionHandlers = {
  onStatus(status: SessionStatus): void;
  onMessage(message: ProtocolMessage): void;
};

export function loadResumeLink(): PairingLink | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PairingLink) : null;
  } catch {
    return null;
  }
}

function saveResumeLink(link: PairingLink | null) {
  try {
    if (link) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(link));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Private browsing: reconnect still works until the page reloads.
  }
}

export class CameraSession {
  #handlers: SessionHandlers;
  #link: PairingLink;
  #camera: CameraLink | null = null;
  #lastHeard = 0;
  #showing: string | null = null;
  #lostAt: number | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #ended = false;

  constructor(link: PairingLink, handlers: SessionHandlers) {
    this.#link = link;
    this.#handlers = handlers;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.#tick();
    });
  }

  // The request id the camera is currently showing, reported on each ping.
  set showing(requestId: string | null) {
    this.#showing = requestId;
  }

  start() {
    this.#handlers.onStatus({ kind: "connecting" });
    void this.#connect();
  }

  send(message: ProtocolMessage): boolean {
    if (!this.#camera) return false;
    this.#camera.send(message);
    return true;
  }

  async #connect() {
    let camera: CameraLink | null = null;

    try {
      camera = await connect(this.#link, {
        onMessage: (message) => {
          this.#lastHeard = Date.now();

          if (message.type === "pair-end") {
            this.#end(
              "Foundry disconnected this camera. Scan a new code from the DiceWatcher panel to pair again."
            );
          } else if (message.type !== "pong") {
            this.#handlers.onMessage(message);
          }
        },
        // Only the live link's close matters, not one already replaced.
        onClose: () => {
          if (camera && camera === this.#camera) this.#lost();
        }
      });
    } catch (error) {
      this.#connectFailed(error);
      return;
    }

    // From now on, reconnect with the resume token, not the one-time code.
    this.#link = { ...this.#link, secret: camera.ack.resumeToken };
    saveResumeLink(this.#link);
    this.#camera = camera;
    this.#lastHeard = Date.now();
    this.#lostAt = null;
    this.#handlers.onStatus({ kind: "paired", userName: camera.ack.userName });
    this.#ping();
    this.#timer ??= setInterval(() => this.#tick(), PING_MS);
  }

  #connectFailed(error: unknown) {
    const refused = error instanceof PairingError && error.refused;
    const message = error instanceof Error ? error.message : String(error);

    if (this.#lostAt === null || refused) {
      // First pairing failed, or Foundry no longer knows this camera.
      this.#end(
        this.#lostAt === null
          ? message
          : "Foundry ended the pairing. Scan a new code from the DiceWatcher panel."
      );
      return;
    }

    if (Date.now() - this.#lostAt > GIVE_UP_MS) {
      this.#end(
        "Could not get back to Foundry. Scan a new code from the DiceWatcher panel."
      );
      return;
    }

    setTimeout(() => {
      if (!this.#ended) void this.#connect();
    }, RETRY_MS);
  }

  #tick() {
    if (this.#ended || !this.#camera) return;

    if (Date.now() - this.#lastHeard > SILENCE_MS) {
      this.#lost();
      return;
    }

    this.#ping();
  }

  #ping() {
    this.#camera?.send({
      v: PROTOCOL_VERSION,
      type: "ping",
      requestId: this.#showing
    });
  }

  #lost() {
    if (this.#ended || !this.#camera) return;

    const dead = this.#camera;

    this.#camera = null;
    dead.close();
    this.#lostAt = Date.now();
    this.#handlers.onStatus({ kind: "reconnecting" });
    void this.#connect();
  }

  #end(message: string) {
    this.#ended = true;
    this.#camera?.close();
    this.#camera = null;
    if (this.#timer) clearInterval(this.#timer);
    saveResumeLink(null);
    this.#handlers.onStatus({ kind: "ended", message });
  }
}
