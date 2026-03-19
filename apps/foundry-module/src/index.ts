import {
  buildLauncherQuery,
  createMockExternalRoll,
  isExternalRollMessage,
  isExternalRollPayload
} from "@dicewatcher/shared";

const MODULE_ID = "dicewatcher";
const LAUNCHER_PANEL_ID = "dicewatcher-launcher-panel";

function registerSettings() {
  game.settings.register(MODULE_ID, "debugLogging", {
    name: "Enable DiceWatcher debug logging",
    hint: "Logs incoming external roll payloads to the browser console.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "webAppUrl", {
    name: "DiceWatcher web app URL",
    hint: "The browser URL that the Foundry launcher should open for testing and pairing.",
    scope: "client",
    config: true,
    type: String,
    default: "http://localhost:5173"
  });
}

export function handleExternalRoll(payload: unknown) {
  if (!isExternalRollPayload(payload)) {
    console.warn("[DiceWatcher] Rejected invalid external roll payload.", payload);
    return;
  }

  console.info("[DiceWatcher] Received external roll payload.", payload);

  void ChatMessage?.create({
    content: `<p><strong>DiceWatcher</strong> received an external d6 roll: ${payload.total}</p>`
  });
}

function getSessionDetails() {
  return {
    sessionId: `${MODULE_ID}-${game.user?.id ?? "anonymous"}`,
    userId: game.user?.id,
    userLabel: game.user?.name,
    foundryOrigin: window.location.origin
  };
}

function getLauncherUrl() {
  const configuredBaseUrl =
    (game.settings.get(MODULE_ID, "webAppUrl") as string | undefined) ??
    "http://localhost:5173";
  const baseUrl = new URL(configuredBaseUrl);

  baseUrl.search = buildLauncherQuery(getSessionDetails()).toString();

  return baseUrl.toString();
}

function openLauncher() {
  window.open(
    getLauncherUrl(),
    "dicewatcher-launcher",
    "popup=yes,width=520,height=900,resizable=yes,scrollbars=yes"
  );
}

function mountLauncherPanel() {
  const existingPanel = document.getElementById(LAUNCHER_PANEL_ID);

  if (existingPanel) {
    existingPanel.remove();
  }

  const panel = document.createElement("aside");
  panel.id = LAUNCHER_PANEL_ID;
  panel.style.position = "fixed";
  panel.style.right = "16px";
  panel.style.bottom = "16px";
  panel.style.zIndex = "80";
  panel.style.width = "280px";
  panel.style.padding = "16px";
  panel.style.borderRadius = "16px";
  panel.style.background = "rgba(20, 21, 27, 0.94)";
  panel.style.border = "1px solid rgba(255,255,255,0.12)";
  panel.style.boxShadow = "0 20px 48px rgba(0,0,0,0.35)";
  panel.style.color = "#f5f0e8";
  panel.style.fontFamily = "system-ui, sans-serif";

  const session = getSessionDetails();
  const launcherUrl = getLauncherUrl();

  panel.innerHTML = `
    <div style="font-size:12px; letter-spacing:0.12em; text-transform:uppercase; color:#ffb98d; margin-bottom:8px;">
      DiceWatcher
    </div>
    <div style="font-size:20px; font-weight:700; margin-bottom:8px;">
      Dev Launcher
    </div>
    <p style="margin:0 0 12px; color:#d8d4ce; line-height:1.4;">
      Open the camera app in a popup, then send a mock external d6 roll back into Foundry.
    </p>
    <div style="margin-bottom:12px; padding:10px; border-radius:12px; background:rgba(255,255,255,0.06);">
      <div style="font-size:12px; color:#ffb98d; text-transform:uppercase; margin-bottom:4px;">Session</div>
      <div style="font-size:14px;">${session.sessionId}</div>
    </div>
    <div style="display:flex; gap:8px; margin-bottom:8px;">
      <button type="button" data-action="open" style="flex:1; border:0; border-radius:999px; padding:10px 12px; font:inherit; font-weight:700; cursor:pointer; background:linear-gradient(135deg,#ffd38a 0%,#ff9f6b 100%); color:#1a1612;">
        Open Web App
      </button>
      <button type="button" data-action="test-roll" style="flex:1; border:1px solid rgba(255,255,255,0.14); border-radius:999px; padding:10px 12px; font:inherit; font-weight:700; cursor:pointer; background:rgba(255,255,255,0.06); color:#f5f0e8;">
        Send Test Roll
      </button>
    </div>
    <p style="margin:0; font-size:12px; line-height:1.4; color:#bcb7af; word-break:break-all;">
      ${launcherUrl}
    </p>
  `;

  panel.querySelector('[data-action="open"]')?.addEventListener("click", () => {
    openLauncher();
  });

  panel
    .querySelector('[data-action="test-roll"]')
    ?.addEventListener("click", () => {
      handleExternalRoll(
        createMockExternalRoll({
          sessionId: session.sessionId,
          userId: session.userId,
          value: 6
        })
      );
    });

  document.body.append(panel);
}

function registerWindowBridge() {
  window.addEventListener("message", (event) => {
    if (!isExternalRollMessage(event.data)) {
      return;
    }

    handleExternalRoll(event.data.payload);
  });

  window.DiceWatcher = {
    handleExternalRoll,
    openLauncher
  };
}

Hooks.once("init", () => {
  registerSettings();
  registerWindowBridge();
  console.info("[DiceWatcher] Module initialized.");
});

Hooks.on("ready", () => {
  mountLauncherPanel();
});
