import {
  DIE_FACES,
  type DieKind,
  PROTOCOL_VERSION,
  type ProtocolMessage,
  parsePairingLink,
  type RollRequest
} from "@dicewatcher/shared";
import { useEffect, useRef, useState } from "react";
import { CameraSession, loadResumeLink } from "./session";

// The camera app as Foundry drives it: pair from the QR link, show what
// Foundry is waiting for, and send the player's values back. Values are typed
// for now; recognition plugs in here in M3.

type Phase =
  | { kind: "no-link" }
  | { kind: "connecting" }
  | { kind: "paired"; userName: string }
  | { kind: "reconnecting" }
  | { kind: "ended"; message: string };

type Pending = {
  request: RollRequest;
  kinds: DieKind[];
  values: (number | null)[];
  status: "editing" | "sent" | "rejected";
  reason?: string;
};

function expand(request: RollRequest): DieKind[] {
  return request.dice.flatMap((term) =>
    Array.from({ length: term.count }, () => term.kind)
  );
}

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "connecting" });
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sessionRef = useRef<CameraSession | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const startedRef = useRef(false);

  pendingRef.current = pending;

  const showing = pending?.request.requestId ?? null;

  useEffect(() => {
    if (sessionRef.current) sessionRef.current.showing = showing;
  }, [showing]);

  useWakeLock(phase.kind === "paired" || phase.kind === "reconnecting");

  useEffect(() => {
    // StrictMode runs effects twice; a pairing secret only works once.
    if (startedRef.current) return;
    startedRef.current = true;

    const link = parsePairingLink(window.location.hash) ?? loadResumeLink();

    // Keep the one-time secret out of history and bookmarks.
    history.replaceState(null, "", window.location.pathname);

    if (!link) {
      setPhase({ kind: "no-link" });
      return;
    }

    const onMessage = (message: ProtocolMessage) => {
      switch (message.type) {
        case "roll-request":
          setNotice(null);
          setPending({
            request: message,
            kinds: expand(message),
            values: expand(message).map(() => null),
            status: "editing"
          });
          break;
        case "roll-closed": {
          const current = pendingRef.current;

          if (current?.request.requestId === message.requestId) {
            setNotice(
              message.outcome === "fulfilled"
                ? `Foundry took ${current.values.join(", ")}.`
                : "Foundry no longer needs that roll."
            );
            setPending(null);
          }
          break;
        }
        case "roll-rejected":
          setPending((current) =>
            current?.request.requestId === message.requestId
              ? { ...current, status: "rejected", reason: message.reason }
              : current
          );
          break;
        default:
          break;
      }
    };

    const session = new CameraSession(link, {
      onMessage,
      onStatus: (status) => {
        if (status.kind === "ended") setPending(null);
        setPhase(status);
      }
    });

    sessionRef.current = session;
    session.start();
  }, []);

  function choose(index: number, value: number) {
    setPending((current) =>
      current
        ? {
            ...current,
            status: "editing",
            values: current.values.map((existing, i) =>
              i === index ? value : existing
            )
          }
        : current
    );
  }

  function send() {
    const session = sessionRef.current;

    if (
      !session ||
      !pending ||
      pending.values.some((value) => value === null)
    ) {
      return;
    }

    const sent = session.send({
      v: PROTOCOL_VERSION,
      type: "roll-fulfillment",
      requestId: pending.request.requestId,
      dice: pending.kinds.map((kind, index) => ({
        kind,
        value: pending.values[index] ?? 0,
        // Typed by the player: there is no recognizer reading to trust yet.
        confidence: 0,
        corrected: true
      }))
    });
    if (sent) {
      setPending({ ...pending, status: "sent" });
    }
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">DiceWatcher</p>
        <h1>{heading(phase, pending)}</h1>
        <p className="lede">{detail(phase)}</p>
      </section>

      {(phase.kind === "paired" || phase.kind === "reconnecting") && pending ? (
        <section className="panel">
          <h2>
            Roll{" "}
            {pending.request.dice
              .map((term) => `${term.count} ${term.kind}`)
              .join(" + ")}
          </h2>
          <p>Roll your dice, then tap what each one shows.</p>
          <div className="die-list">
            {pending.kinds.map((kind, index) => (
              <fieldset
                className="die-row"
                // Dice of one request never reorder, so the index is stable.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above
                key={index}
              >
                <legend>
                  Die {index + 1} ({kind})
                </legend>
                <div className="face-buttons">
                  {Array.from(
                    { length: DIE_FACES[kind] },
                    (_, face) => face + 1
                  ).map((face) => (
                    <button
                      aria-pressed={pending.values[index] === face}
                      className={`face-button${pending.values[index] === face ? " selected" : ""}`}
                      disabled={pending.status === "sent"}
                      key={face}
                      onClick={() => choose(index, face)}
                      type="button"
                    >
                      {face}
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <button
            className="action"
            disabled={
              phase.kind !== "paired" ||
              pending.status === "sent" ||
              pending.values.some((value) => value === null)
            }
            onClick={send}
            type="button"
          >
            Send to Foundry
          </button>
          {pending.status === "sent" ? (
            <p className="status">Sent. Waiting for Foundry…</p>
          ) : null}
          {pending.status === "rejected" ? (
            <p className="status warning">
              Foundry refused that: {pending.reason}
            </p>
          ) : null}
        </section>
      ) : null}

      {phase.kind === "paired" && !pending && notice ? (
        <section className="panel">
          <p className="status success">{notice}</p>
        </section>
      ) : null}

      <footer className="footer">
        <a href="./bench.html">Recognition bench</a>
      </footer>
    </main>
  );
}

function heading(phase: Phase, pending: Pending | null): string {
  switch (phase.kind) {
    case "no-link":
      return "Pair from Foundry to start.";
    case "connecting":
      return "Connecting to Foundry…";
    case "paired":
      return pending ? "Foundry is waiting for your roll." : "Ready to roll.";
    case "reconnecting":
      return "Reconnecting to Foundry…";
    case "ended":
      return "Not connected to Foundry.";
  }
}

function detail(phase: Phase): string {
  switch (phase.kind) {
    case "no-link":
      return "In Foundry, open the DiceWatcher panel and click Pair phone, then scan the QR code with this phone's camera.";
    case "connecting":
      return "Checking the pairing code with your Foundry window.";
    case "paired":
      return `Paired with ${phase.userName || "Foundry"}. Make any roll in Foundry that uses DiceWatcher dice and it will show up here.`;
    case "reconnecting":
      return "The connection dropped, probably while the screen was off. Getting it back; no need to scan again.";
    case "ended":
      return phase.message;
  }
}

// Keeps the phone's screen on while paired, so the browser does not pause
// the page between rolls. Re-acquired when the page becomes visible again,
// since browsers release the lock when it is hidden.
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;

    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock.request("screen").then(
        (sentinel) => {
          if (cancelled) void sentinel.release();
          else lock = sentinel;
        },
        () => {
          // Not allowed (e.g. low battery mode); the heartbeat still recovers.
        }
      );
    };

    acquire();
    document.addEventListener("visibilitychange", acquire);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release();
    };
  }, [active]);
}
