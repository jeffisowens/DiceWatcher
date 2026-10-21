# DiceWatcher Project Spec

_Rewritten October 2026 after an engineering review. The reasoning behind each change is in [review-2026-10.md](./review-2026-10.md)._

## 1. Goal

A player rolls physical dice in front of a phone or webcam, and the results flow into Foundry VTT's own dice system, so any roll a game system makes (attacks, damage, saves) can be fulfilled with real dice.

## 2. Product shape

Three packages, as today:

1. **Camera web app** (`apps/web`): a static site hosted over HTTPS. Captures frames, recognizes dice, lets the player confirm, sends results.
2. **Foundry module** (`apps/foundry-module`): registers a DiceWatcher dice fulfillment method, owns pairing, validates and feeds results into pending rolls. Does no computer vision.
3. **Shared** (`packages/shared`): message schemas with runtime validation, pairing protocol, and a pure (DOM-free) recognition core so it can be tested in Node.

## 3. Locked decisions

These are the decisions the rest of the plan depends on. Changing one means revisiting this document.

### 3.1 Foundry owns the roll (fulfillment API)

The module registers a fulfillment method:

```ts
CONFIG.Dice.fulfillment.methods.dicewatcher = {
  label: "DiceWatcher (camera)",
  icon: "<i class=\"fa-solid fa-camera\"></i>",
  interactive: true
};
```

Players pick DiceWatcher per die type in Foundry's Dice Configuration. When a roll needs those dice, Foundry opens its `RollResolver`; the module tells the paired camera what is pending (e.g. `2×d6`); confirmed results come back and are fed in with `Roll.registerResult("dicewatcher", "d6", value)`. The system then evaluates the roll normally, so roll modes, chat cards, Dice So Nice and system automation all work. Manual entry in the resolver is the built-in fallback.

The camera never invents a roll on its own in the MVP; it only answers a pending request. (A "free roll" mode can come later.)

### 3.2 Transport: WebRTC data channel, paired by QR code

`window.postMessage` cannot reach a phone. The MVP transport is a peer-to-peer WebRTC data channel between the player's Foundry client and the camera app:

- The Foundry module shows a QR code containing the web app URL, a peer id and a one-time pairing secret.
- The camera app connects using a public signaling broker (PeerJS cloud to start; self-hostable later), then proves the secret before any roll message is accepted.
- No DiceWatcher server to run. Works whether Foundry is self-hosted, on a VPS, or on a host like Forge, because the connection is between the two browsers.
- The existing popup/`postMessage` path stays as the same-device webcam transport behind the same message interface.

A spike (Milestone 1) must confirm this works across a phone on cellular data and a desktop on home Wi-Fi. If NAT traversal without TURN proves unreliable, fall back to a tiny relay (one WebSocket room per pairing) before building anything else on top.

### 3.3 Hosting: static HTTPS

Phones only allow camera access on HTTPS. The web app is deployed to GitHub Pages from CI. Local development on a phone uses Vite with a self-signed cert (`@vitejs/plugin-basic-ssl`) or a tunnel.

### 3.4 Vision is measured, not eyeballed

No recognition change merges without numbers. A committed, labeled fixture set and a Node test report accuracy, and CI fails on regression. The recognizer is a pure function `(pixels, width, height, request) → DieReading[]` with no DOM access.

### 3.5 Foundry v14

The module targets Foundry VTT v14, the current release. Older versions are not supported.

### 3.6 Unchanged from the original plan

- d6 first, still capture first, user confirmation required, controlled tray/background expected.

## 4. User flow (MVP)

1. GM enables the module. Each player sets d6 fulfillment to "DiceWatcher" in Dice Configuration.
2. Player clicks **Pair camera** in Foundry, scans the QR code with their phone (or clicks **Use this computer's webcam**).
3. Player triggers any roll in Foundry. In the MVP only d6 terms route to DiceWatcher; other dice use Foundry's digital dice.
4. Foundry's resolver opens; the phone shows "Roll 2 d6".
5. Player rolls, taps **Capture**. The app shows what it saw with confidence and the debug overlay on demand.
6. Player confirms or corrects each die and taps **Send**.
7. Values fill the resolver; the roll completes in Foundry like any other.

## 5. Contracts

Validated with Zod in `packages/shared`. Every message is versioned.

```ts
type DieKind = "d6"; // widened later: "d4" | "d8" | "d10" | "d12" | "d20"

// Foundry → camera
type RollRequest = {
  v: 1;
  type: "roll-request";
  requestId: string;
  dice: { kind: DieKind; count: number }[];
};

// camera → Foundry
type RollFulfillment = {
  v: 1;
  type: "roll-fulfillment";
  requestId: string;
  dice: {
    kind: DieKind;
    value: number;        // validated against kind: 1..faces
    confidence: number;   // 0..1, from the recognizer
    corrected: boolean;   // player changed the recognizer's value
  }[];
};

// Foundry → camera: the request is no longer pending
type RollClosed = {
  v: 1;
  type: "roll-closed";
  requestId: string;
  outcome: "fulfilled" | "cancelled"; // cancelled: typed in Foundry or resolver closed
};

// Foundry → camera: a fulfillment was refused
type RollRejected = { v: 1; type: "roll-rejected"; requestId: string; reason: string };

// pairing
type PairHello = { v: 1; type: "pair-hello"; secret: string; client: "camera-web" };
type PairAck  = { v: 1; type: "pair-ack"; userId: string; userName: string; resumeToken: string };
type PairEnd  = { v: 1; type: "pair-end" }; // Foundry → camera: stop reconnecting

// heartbeat: camera → Foundry every few seconds; Foundry answers pong, resends a
// request the camera missed, and closes one the camera still shows
type Ping = { v: 1; type: "ping"; requestId: string | null };
type Pong = { v: 1; type: "pong" };
```

Pairing links put `peer`, `secret` and an optional `signal` server in the URL fragment, so the secret never reaches the web host. A camera that drops (a phone screen turning off) reconnects by sending its `resumeToken` as the `pair-hello` secret; the token lasts until Disconnect, a new pairing or a Foundry reload. Values typed by the player are sent with `confidence: 0` and `corrected: true`.

Totals are never sent; Foundry computes them. The module rejects a fulfillment whose dice don't match the open request.

## 6. Vision strategy

### 6.1 MVP (d6 pips)

Keep the existing pip-counting pipeline but restructure it:

- Extract a pure core from `vision.ts` into `packages/shared` (or a new `packages/vision`); a thin browser adapter does canvas/image loading.
- Run it in a Web Worker in the app.
- Prune candidate strategies that the fixture report shows don't earn their keep.
- Support N d6 in frame (the request says how many to expect, which is a strong prior).

### 6.2 Fixture set and harness

- `fixtures/d6/<value>/<name>.jpg` plus a manifest (die color, background, lighting, device).
- Start with at least 150 images: 3+ dice colors, 2 backgrounds, 2 lighting setups, phone and webcam, single and multiple dice.
- `pnpm test:vision` prints per-value accuracy, a confusion matrix and "confident but wrong" count; CI fails if accuracy drops below the committed baseline.
- The in-app fixture/batch tools move to a separate dev route (`/bench`) and can save captures in the fixture format.

### 6.3 Decision point: heuristics vs. a learned model

After Milestone 3, compare against the target (≥98% correct at the confidence threshold, <1% confident-but-wrong). If heuristics fall short, or when starting d20 (numerals, where pip counting doesn't apply), switch to a small detector/classifier run in the browser (ONNX Runtime Web or TF.js), trained on the same fixture set. The harness and contracts stay the same either way, which is the point of building them first.

## 7. Trust and security

- Rolls accepted only from a paired peer that proved the one-time secret; secret rotates per pairing and expires after a few minutes unused.
- Results only fill a pending request for the user who owns the Foundry client; there is no path for one player's camera to roll for another.
- Values range-checked per die kind; mismatched counts rejected.
- Chat card notes "DiceWatcher" and whether any die was corrected. Optional GM setting: snapshot thumbnail attached to the roll for audit.

## 8. Milestones

Each milestone ends with a demo and its exit criteria checked.

### M0 — Foundations (small)

- Vitest, Biome (see §9), GitHub Actions running typecheck/lint/test/build.
- Zod schemas for the contracts above, with tests (range checks, version field).
- Remove committed build output; fix README; align versions; `debugLogging` default off; Foundry compatibility set to v14 (minimum and verified).
- Use community Foundry types instead of the hand-written shim.

Exit: CI green on a PR.

### M1 — Fulfillment + transport spike (with manual input)

- Module registers the fulfillment method and hooks the `RollResolver`.
- QR pairing and WebRTC data channel between Foundry and the web app; popup transport kept for same-device webcam.
- Web app deployed to GitHub Pages; shows pending request and lets the player type values (no CV yet).

Exit: from a phone on cellular data, a `2d6` attack roll triggered in Foundry (dnd5e) is fulfilled with typed values and appears as a normal roll card with Dice So Nice.

### M2 — Vision harness

- Pure recognition core extracted and running in Node.
- Fixture set (≥150 images) committed; `pnpm test:vision` and CI baseline.
- Dev bench route for capturing new fixtures.

Exit: CI reports current accuracy of the existing pipeline on the full fixture set.

### M3 — d6 recognition in the loop

- Recognizer in a Web Worker, multi-d6 support, wired into the request → capture → confirm → send flow.
- Improve the pipeline against the harness until targets are met, or trigger the §6.3 decision.

Exit: ≥98% correct on fixtures with <1% confident-but-wrong; 20 consecutive real rolls from a phone into Foundry with no more than 1 correction.

### M4 — MVP polish

- Pairing persistence and reconnect, clear error states, ApplicationV2 status panel, recent roll history, module packaging and release workflow (manifest URL on GitHub Releases).

Exit: a player who didn't build it can install, pair and play a session.

### Later

Motion-based auto-capture; d20 and other polyhedrals (likely via a learned model); mixed dice; free rolls outside a pending request; self-hosted signaling/TURN option.

## 9. Tooling

### 9.1 Keep

| Area | Tool | Why |
|---|---|---|
| Monorepo | pnpm workspaces, TypeScript | Already working; no reason to change |
| Web app | Vite + React | Fine for a small camera/review UI |
| Module bundling | esbuild | Fast, simple, one output file for Foundry |

### 9.2 Add

| Area | Tool | Why | Milestone |
|---|---|---|---|
| Validation | `zod` (or `valibot` if bundle size matters) | Range checks and versioned messages (review C1, C5) | M0 |
| Tests | Vitest | Shares Vite config; runs vision tests in Node | M0 |
| Lint/format | Biome | One fast tool for linting and formatting, including React hooks rules; no linting today | M0 |
| Foundry types | `@league-of-foundry-developers/foundry-vtt-types` | Replace the hand-written shim. These lag Foundry releases; if v14 coverage is missing, keep a slim shim for just the APIs we use (fulfillment, `Roll`, `ApplicationV2`) | M0 |
| Transport | `peerjs` | WebRTC data channel with a free hosted broker; self-hostable later | M1 |
| Pairing | `qrcode` | Render the pairing QR in Foundry. The phone scans with its native camera, so no QR reader is needed | M1 |
| Phone dev | `@vitejs/plugin-basic-ssl` | HTTPS dev server so phones allow the camera | M1 |
| Fixture decoding | `sharp` (dev only) | Decode JPEG/PNG fixtures to raw RGBA for Node tests | M2 |
| Worker RPC | `comlink` | Clean async calls into the recognition Web Worker | M3 |

### 9.3 Image processing

The current recognizer uses no library: every step (grayscale, thresholding, connected components, candidate search) is hand-written pixel loops. That is most of why `vision.ts` is 1,700 lines. The original spec named OpenCV.js but it was never adopted.

| Option | Good for | Costs |
|---|---|---|
| **OpenCV.js** (`@techstark/opencv-js`) | Classic pipeline: adaptive threshold, `findContours`, `minAreaRect`, `warpPerspective`, `SimpleBlobDetector`/`HoughCircles`. Replaces most of today's hand-written code with tested primitives. Runs in a Worker and in Node. | ~8–10 MB WASM download (cache it); C-style API with manual `Mat.delete()` memory management |
| **ONNX Runtime Web** (`onnxruntime-web`) + a small YOLO-style detector | Learned detection: finds every die, its type and its top face in one pass. Handles d20 numerals, mixed dice, varied backgrounds. Same model runs in Node via `onnxruntime-node` for tests. WebGPU with WASM fallback. | Needs a labeled dataset and a training step (public dice datasets exist as a starting point); model ~5–15 MB |
| MediaPipe Tasks Vision / TensorFlow.js | Same role as ONNX | Narrower model export path; ONNX is the more portable target |
| jsfeat, tracking.js, image-js | Lightweight helpers | Unmaintained or too limited for this job |

**Recommendation.** For M2–M3, port the existing pip pipeline onto OpenCV.js primitives inside the pure recognition core, which should shrink it substantially and make it easier to tune against the harness. Plan on ONNX Runtime Web with a trained detector as the long-term path: d20 support essentially requires it, and the fixture set built in M2 doubles as training and evaluation data. The §6.3 decision point picks the moment to switch. Because the recognizer sits behind one interface (`(pixels, width, height, request) → DieReading[]`), switching engines doesn't touch the app, the module or the contracts.

## 10. Risks

| Risk | Mitigation |
|---|---|
| WebRTC fails behind some NATs without TURN | M1 spike tests real networks first; relay fallback ready |
| Fulfillment API changes between Foundry versions | Target v14 only, re-verify on each Foundry release, keep the adapter small |
| Heuristic CV plateaus below target | Harness makes it visible early; §6.3 decision point |
| Lighting/background variability | Fixtures deliberately cover it; MVP requires a tray |
| Players distrust self-reported rolls | Confirmation and correction flag on the card; optional snapshot audit |
