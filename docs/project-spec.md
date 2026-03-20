# DiceWatcher Project Spec

## 1. Goal

Build a system that allows a player to roll physical dice in front of a device camera, detect the result, and send that result into Foundry VTT so it can be used in place of Foundry's built-in digital dice rolling.

The first version should prioritize reliability and development speed over breadth.

## 2. Product Direction

### 2.1 Product shape

DiceWatcher will be split into two applications:

1. A browser-based camera web app
2. A Foundry VTT module

These applications will share TypeScript types and message contracts through a shared package.

### 2.2 Why this shape

- Mobile browsers are better suited for camera capture than embedding everything in Foundry.
- Foundry integration can stay focused on pairing, validation, and roll creation.
- The camera stack and the Foundry stack can evolve independently.
- Shared contracts reduce integration drift.

## 3. MVP Definition

### 3.1 In scope

- One die type: `d6`
- One roll at a time
- Camera preview in browser
- Manual capture button
- Still-image analysis after capture
- User confirmation or correction before send
- Foundry module receives result and posts it as an external roll/chat message
- Basic session pairing between browser client and Foundry user/session

### 3.2 Out of scope

- Auto-detecting any common polyhedral die
- Full motion-based automatic roll completion
- Multiple dice types in the same roll
- No-confirmation fully automatic roll submission
- Handling arbitrary table backgrounds and poor lighting
- Complex Foundry workflow replacement for every game system on day one

## 4. User Flow

### 4.1 Player flow

1. Player opens DiceWatcher on a phone or laptop browser.
2. Player pairs the browser app to a Foundry session.
3. Player places one `d6` in a defined tray or capture area.
4. Player taps `Capture`.
5. App freezes the frame and analyzes the image.
6. App shows detected value with confidence.
7. Player confirms or corrects the value.
8. App sends the confirmed result to Foundry.
9. Foundry posts the roll result to chat and/or creates an external roll event.

### 4.2 GM flow

1. GM installs and enables the DiceWatcher Foundry module.
2. GM or player opens the module panel inside Foundry.
3. Foundry displays pairing instructions and connection status.
4. External roll results appear in Foundry as trusted or reviewable events depending on configuration.

## 5. System Architecture

## 5.1 Monorepo layout

```text
DiceWatcher/
  apps/
    web/
    foundry-module/
  packages/
    shared/
  docs/
    project-spec.md
```

## 5.2 Applications

### `apps/web`

Responsibilities:

- Camera permission flow
- Live preview
- Capture region UI
- Snapshot capture
- Vision pipeline execution
- Result review and correction
- Pairing and transport to Foundry

Suggested stack:

- React
- TypeScript
- Vite
- CSS or Tailwind if desired
- OpenCV.js for initial computer vision pipeline

### `apps/foundry-module`

Responsibilities:

- Register module and settings
- Create pairing/session UI
- Receive external roll payloads
- Validate session/token/user routing
- Convert incoming payloads into Foundry chat messages and/or roll objects
- Display connection and recent external roll status

Suggested stack:

- TypeScript
- Vite or Foundry-compatible bundler
- Foundry module manifest and scripts

### `packages/shared`

Responsibilities:

- Shared type definitions
- Message/event names
- Payload schemas
- Validation helpers

Suggested stack:

- TypeScript
- Zod for runtime validation

## 6. Integration Model

## 6.1 Transport

For MVP, the system needs a simple real-time or request-response transport between the web app and Foundry.

Preferred order:

1. WebSocket bridge if easy to host within the module or companion process
2. HTTP POST endpoint if simpler operationally

MVP recommendation:

- Use a small explicit session model
- Pair a browser app instance with a Foundry user/session
- Require a session token before accepting rolls

## 6.2 Roll contract

```ts
export type DieKind = "d6";

export type DieResult = {
  id: string;
  kind: DieKind;
  value: number;
  confidence: number;
};

export type ExternalRollPayload = {
  sessionId: string;
  userId?: string;
  source: "camera-web";
  dice: DieResult[];
  total: number;
  imageTimestamp: string;
  corrected: boolean;
};
```

Possible future fields:

- snapshot reference
- roll mode
- actorId
- itemId
- formula
- systemId

## 7. Computer Vision Strategy

## 7.1 MVP assumptions

To keep V1 practical, the vision pipeline will assume:

- One `d6` in frame
- Contrasting tray/background
- Reasonable lighting
- User-triggered still capture
- Review step before submission

## 7.2 Initial detection path

For the first prototype, avoid OCR. Count pips instead.

Pipeline:

1. Capture still frame
2. Crop to tray region
3. Convert to grayscale
4. Apply blur/threshold
5. Detect contours
6. Identify candidate square-ish die region
7. Normalize perspective
8. Detect circular dark/light pip regions
9. Count pips
10. Return value and confidence

## 7.3 Why `d6` first

- Easier shape detection
- Pip counting is simpler than numeral OCR
- Faster prototype feedback
- Better chance of reliable demo-quality results

## 7.4 Expansion path after MVP

1. Multiple `d6`s
2. Motion-based auto-capture
3. `d20` support
4. Mixed dice sets
5. Stronger ML-assisted detection/classification

## 8. Foundry Responsibilities

The Foundry module should not do computer vision. It should focus on trusted ingestion and user-facing integration.

Core responsibilities:

- Pairing flow
- Connection state
- Roll acceptance policy
- Chat message creation
- Optional roll object generation
- Optional external roll history panel

Module settings to consider:

- Require confirmation in web app
- Allow only paired users
- Show external roll badge in chat
- GM approval mode on/off

## 9. Security and Trust

This project effectively injects roll results into Foundry, so trust rules matter.

MVP rules:

- Only accept rolls from paired sessions
- Use short-lived session token or pairing code
- Tie incoming rolls to a specific Foundry user
- Log recent external roll submissions

Future options:

- Snapshot retention for audit trail
- GM-side approval queue
- Confidence threshold warnings

## 10. Milestones

## Milestone 0: Repo setup

Deliverables:

- Monorepo initialized
- Shared package initialized
- Web app scaffold created
- Foundry module scaffold created
- Basic docs committed

Exit criteria:

- Project builds
- Packages reference each other correctly

## Milestone 1: Foundry bridge with mock data

Deliverables:

- Module loads in Foundry
- Pairing/session stub exists
- Mock external roll payload can be submitted
- Foundry posts result to chat

Exit criteria:

- Manual test proves end-to-end message ingestion without CV

## Milestone 2: Camera app without CV

Deliverables:

- Camera preview works
- Capture button works
- Review UI works
- Manual value input works
- Confirmed values send to Foundry

Exit criteria:

- Phone or desktop browser can submit a manual external `d6` result

## Milestone 3: Single `d6` recognition

Deliverables:

- Still-frame image processing
- Candidate die detection
- Pip counting
- Confidence scoring

Exit criteria:

- Controlled-environment `d6` detection is accurate enough for repeated local tests

## Milestone 4: MVP polish

Deliverables:

- Better pairing UX
- Error messages
- Recent roll history
- Retry flows
- Basic styling

Exit criteria:

- A player can reliably perform repeated confirmed `d6` rolls from browser to Foundry

## 11. Suggested Task Breakdown

### Foundation

- Initialize workspace
- Set up package manager workspaces
- Configure TypeScript base config
- Add linting and formatting
- Add shared package

### Foundry

- Create module manifest
- Register settings
- Build pairing panel
- Implement mock payload receiver
- Implement chat/roll creation adapter

### Web

- Build landing/pairing screen
- Build camera permission and preview screen
- Add capture overlay
- Add capture/review flow
- Add send-to-Foundry client

### Vision

- Add frame preprocessing utilities
- Add tray crop utilities
- Add contour detection experiment
- Add pip detection experiment
- Add confidence heuristic

## 12. Technical Recommendations

### Monorepo tooling

- Package manager: `pnpm`
- Language: TypeScript
- Validation: `zod`
- Frontend: React + Vite

### Testing

- Unit tests for shared contracts
- Unit tests for simple Foundry payload adapters where possible
- Saved-image fixture tests for CV pipeline

### Logging

- Browser debug panel in dev mode
- Module-side debug logging toggle

## 13. Risks

Top project risks:

- Lighting variability
- Dice touching tray edges or partial occlusion
- Low-confidence false positives
- Difficulty mapping external results cleanly into all Foundry game systems
- Mobile browser performance for repeated analysis

Mitigations:

- Narrow MVP assumptions
- Require confirmation step
- Start with controlled image fixtures
- Validate Foundry bridge with mock data before CV work

## 14. Current Prototype Benchmark

As of March 20, 2026, the local-only prototype has reached the following benchmark:

- Foundry bridge accepts paired browser rolls and posts them into chat
- Web app supports camera capture, uploaded fixtures, review/correction, and send-to-Foundry
- Controlled `d6` benchmark set for faces `1` through `6` is passing
- Reused face-4 stress set is passing except for one low-quality image where the die is not reliably localized
- Web app now surfaces low-confidence or weak-crop cases with a retake recommendation

Current benchmark interpretation:

- The local-only recognizer is strong enough for MVP-style repeated testing in controlled conditions
- The main remaining failure mode is poor localization on certain low-quality or shadow-heavy images
- For MVP, that remaining miss is acceptable if the UX clearly recommends retaking weak captures

Known limitations to keep in mind:

- One die only
- `d6` only
- Controlled tray/background still expected
- Uneven lighting, blur, or die shadows can still degrade localization
- Manual review/correction remains part of the intended MVP flow

Recommended benchmark sets to preserve:

- Canonical pass set: one saved fixture per face from `1` through `6`
- Robustness set: the reused multi-shot face-4 batch
- Known hard failure set: the remaining low-quality image that fails die localization

## 15. Immediate Next Steps

1. Initialize the monorepo structure.
2. Scaffold `apps/web`, `apps/foundry-module`, and `packages/shared`.
3. Define the shared roll payload schema.
4. Implement a mock-roll path from web app to Foundry.
5. Only then begin the first `d6` image-processing prototype.

Now that those steps are complete, the next product-focused priorities are:

1. Manual end-to-end Foundry testing with the current polished launcher and web review flow
2. Capture guidance and retake UX improvements
3. Optional recent-roll or history UX in the Foundry launcher
4. Saving and reusing the current benchmark batches for future regression checks

## 16. Locked decisions for now

- Separate browser app and Foundry module
- `d6` first
- Manual capture first
- User confirmation required in MVP
- Controlled tray/background expected in MVP
