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

## Next Steps

See the milestones in [docs/project-spec.md](docs/project-spec.md#8-milestones). Next up is M0 (tests, lint, CI) and the M1 spike: Foundry's dice fulfillment API plus a phone-to-Foundry WebRTC connection.
