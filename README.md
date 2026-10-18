# DiceWatcher

DiceWatcher is a web + Foundry VTT integration project for reading physical dice rolls from a camera and sending those results into Foundry VTT as external rolls.

The initial goal is a narrow, reliable MVP:

- Mobile-friendly camera web app
- Single `d6` support first
- Still-image capture first
- User confirmation before sending
- Foundry VTT module bridge for ingesting results

Project planning docs live in [docs/project-spec.md](docs/project-spec.md). The October 2026 engineering review is in [docs/review-2026-10.md](docs/review-2026-10.md).

## Workspace

```text
apps/
  foundry-module/
  web/
packages/
  shared/
docs/
  project-spec.md
```

## How it works

1. Each player sets d6 fulfillment to **DiceWatcher (camera)** in Foundry's Dice Configuration.
2. In the DiceWatcher panel in Foundry, click **Pair phone** and scan the QR code, or click **Use this computer's webcam**.
3. Any roll that needs DiceWatcher dice opens Foundry's roll resolver and shows up on the phone. Tap the values and send; Foundry finishes the roll as usual. Typing the values in Foundry's resolver still works.

The phone and Foundry talk directly over a WebRTC data channel. They find each other through the free PeerJS cloud server, or your own [PeerJS server](https://github.com/peers/peerjs-server) set in the module settings. The QR link carries a one-time secret that expires after five minutes.

The camera app is published to GitHub Pages at <https://jeffisowens.github.io/DiceWatcher/> from `main`. The recognition prototype is at `bench.html`.

## Development

```sh
pnpm install
pnpm dev:web       # camera app on http://localhost:5173
pnpm dev:phone     # same, over HTTPS on your LAN so a phone can use its camera
pnpm build:foundry # Foundry module into apps/foundry-module/dist
pnpm lint && pnpm typecheck && pnpm test
```

To try a local camera app, set the module's **camera app URL** setting to your dev server's address.

## Next steps

See the milestones in [docs/project-spec.md](docs/project-spec.md#8-milestones). M1 (fulfillment and phone pairing with typed values) is in place; its exit check on a real phone over cellular data is still to do. Next is M2, the vision harness.
