# M1 real-world check

The M1 exit check from the [spec](./project-spec.md#m1--fulfillment--transport-spike-with-manual-input): from a phone on cellular data, a `2d6` roll triggered in Foundry (dnd5e) is fulfilled with typed values and appears as a normal roll card with Dice So Nice.

Plan for about 30 minutes. You need a computer that can run Foundry VTT v14, a phone with mobile data, and this repo checked out on the PR branch.

## 1. Publish the camera app from the PR branch

The phone loads the camera app from GitHub Pages. It has to be the M1 version, which so far exists only on the PR branch.

1. In the GitHub repo, open **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Open **Settings → Environments → github-pages**. Under **Deployment branches and tags**, add the PR branch (`claude/project-thread-qo0xfr`). By default Pages only deploys from `main`.
3. Open **Actions → Deploy web app → Run workflow**, choose the PR branch, and run it.
4. When the run is green, open <https://jeffisowens.github.io/DiceWatcher/> on your phone. You should see **"Pair from Foundry to start."**

After the PR merges, every push to `main` redeploys the app, and you can remove the branch from step 2.

## 2. Build and install the Foundry module

There is no release yet (that comes in M4), so install the module from source.

```sh
git checkout claude/project-thread-qo0xfr
pnpm install
pnpm build:foundry
pnpm --filter @dicewatcher/foundry-module package
```

Copy `apps/foundry-module/package/dicewatcher` into your Foundry user data folder at `Data/modules/dicewatcher`. If an old copy is there, replace it.

## 3. Set up a test world

1. Make sure the **dnd5e** system and the **Dice So Nice!** module are installed.
2. Create or open a dnd5e world on Foundry v14.
3. In **Manage Modules**, enable **DiceWatcher** and **Dice So Nice!**.
4. In **Configure Settings → DiceWatcher**, check that **Camera app URL** is `https://jeffisowens.github.io/DiceWatcher/` and **Pairing server** is blank. Turn on **debug logging**, which helps if something fails.
5. In **Configure Settings → Core → Dice Configuration**, set **d6** to **DiceWatcher (camera)**. Leave every other die on its default.
6. Give a character a weapon that deals 2d6 damage, such as a greatsword.

## 4. Pair the phone over cellular

1. On the phone, **turn Wi-Fi off** so it uses mobile data.
2. In Foundry, the DiceWatcher panel is in the bottom-right corner. Click **Pair phone**.
3. Scan the QR code with the phone's camera app and open the link.
4. The phone should say **"Ready to roll."** and **"Paired with <your user name>"**. The Foundry panel should say **"Camera paired"**.

## 5. Roll and fulfill

1. In Foundry, roll the greatsword's **damage**. (The attack roll is a d20, so it uses Foundry's digital dice.)
2. Foundry's roll resolver window opens. The phone shows **"Roll 2 d6"**, and the panel shows **"Waiting for: 2 d6"**.
3. Roll two real d6. On the phone, tap each value, then tap **Send to Foundry**.
4. Check that:
   - the resolver closes by itself;
   - Dice So Nice shows dice with **your** values;
   - the chat card has the right total (your two values plus the modifier);
   - the phone says **"Foundry took X, Y."**

That completes the exit check.

## 6. Quick extra checks (optional)

- **Typing in Foundry still works.** Roll damage again, type both values into Foundry's resolver, and submit. The phone should say **"Foundry no longer needs that roll."**
- **Closing the resolver.** Roll again and close the resolver window. The phone should clear its request the same way.
- **One-time code.** Open the same QR link a second time. That page should say **"Could not pair."**
- **Webcam fallback.** Click **Use this computer's webcam**. A popup opens and pairs, and the phone shows **"Disconnected from Foundry."** Rolls now go to the popup.

## If something goes wrong

| What you see | Likely cause | What to send back |
|---|---|---|
| Panel says "Could not reach the pairing server" | The PeerJS cloud server is down or blocked | The exact message |
| Phone stays on "Connecting to Foundry…", then shows "Foundry did not answer" | The networks can't open a direct WebRTC link (the NAT risk in spec §10) | Whether the same thing works with the phone on Wi-Fi |
| Phone shows "Foundry refused the pairing" | The code expired (5 minutes) or was already used | Retry with a fresh **Pair phone** |
| Resolver opens but the phone shows nothing | Dice Configuration isn't routing d6 to DiceWatcher, or the v14 resolver markup differs from what the module reads | A screenshot of the resolver and the browser console (F12) |
| Values reach the resolver but the roll doesn't finish | The v14 `registerResult` behavior differs | The browser console |

With debug logging on, the browser console in Foundry shows every message sent to and received from the phone, prefixed with `[DiceWatcher]`.
