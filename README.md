# DiceWatcher

DiceWatcher is a web + Foundry VTT integration project for reading physical dice rolls from a camera and sending those results into Foundry VTT as external rolls.

The initial goal is a narrow, reliable MVP:

- Mobile-friendly camera web app
- Single `d6` support first
- Still-image capture first
- User confirmation before sending
- Foundry VTT module bridge for ingesting results

Project planning docs live in [docs/project-spec.md](C:\Users\ifcja\OneDrive\Documents\Projects\DiceWatcher\docs\project-spec.md).

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

1. Install Node.js and `pnpm`.
2. Run `pnpm install`.
3. Build the mock roll path from the web app into the Foundry module.
4. Start the first `d6` still-image recognition prototype.
