import { useState } from "react";
import {
  buildLauncherQuery,
  createExternalRollMessage,
  createMockExternalRoll,
  parseLauncherSession
} from "@dicewatcher/shared";

export function App() {
  const session = parseLauncherSession(new URLSearchParams(window.location.search));
  const [selectedValue, setSelectedValue] = useState(4);
  const [sendState, setSendState] = useState<"idle" | "sent" | "missing-opener">(
    "idle"
  );

  function sendMockRoll() {
    const mockRoll = createMockExternalRoll({
      sessionId: session.sessionId,
      userId: session.userId,
      value: selectedValue
    });

    if (!window.opener) {
      setSendState("missing-opener");
      return;
    }

    const targetOrigin = session.foundryOrigin ?? "*";

    window.opener.postMessage(
      createExternalRollMessage(mockRoll),
      targetOrigin
    );
    setSendState("sent");
  }

  const pairingPreview = buildLauncherQuery(session).toString();
  const mockRoll = createMockExternalRoll({
    sessionId: session.sessionId,
    userId: session.userId,
    value: selectedValue
  });

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">DiceWatcher MVP</p>
        <h1>Camera-driven physical dice for Foundry VTT</h1>
        <p className="lede">
          The first build will focus on a controlled, reliable flow: capture one
          d6, confirm the result, and send it into Foundry as an external roll.
        </p>
        <dl className="session-grid">
          <div>
            <dt>Session</dt>
            <dd>{session.sessionId}</dd>
          </div>
          <div>
            <dt>User</dt>
            <dd>{session.userLabel ?? session.userId ?? "Unpaired"}</dd>
          </div>
        </dl>
      </section>

      <section className="panel">
        <h2>Dev bridge</h2>
        <p>
          This scaffold can send a mock external roll to a Foundry window that
          opened it by using <code>window.postMessage</code>.
        </p>
        <label className="value-picker" htmlFor="mock-roll-value">
          Mock d6 value
        </label>
        <select
          className="select"
          id="mock-roll-value"
          onChange={(event) => {
            setSelectedValue(Number(event.target.value));
            setSendState("idle");
          }}
          value={selectedValue}
        >
          {[1, 2, 3, 4, 5, 6].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <button className="action" onClick={sendMockRoll} type="button">
          Send mock roll to Foundry
        </button>
        {sendState === "sent" ? (
          <p className="status success">
            Mock roll posted to the opener window.
          </p>
        ) : null}
        {sendState === "missing-opener" ? (
          <p className="status warning">
            No opener window was found. For this mock bridge, launch the app
            from a Foundry-hosted window or popup.
          </p>
        ) : null}
      </section>

      <section className="panel">
        <h2>First milestone</h2>
        <ol>
          <li>Open the camera app from Foundry</li>
          <li>Send a mock external roll back to Foundry</li>
          <li>Replace the mock payload with confirmed capture results</li>
          <li>Swap the dev bridge for a real paired transport</li>
        </ol>
      </section>

      <section className="panel">
        <h2>Pairing payload preview</h2>
        <pre>{pairingPreview}</pre>
      </section>

      <section className="panel">
        <h2>Shared roll payload preview</h2>
        <pre>{JSON.stringify(mockRoll, null, 2)}</pre>
      </section>
    </main>
  );
}
