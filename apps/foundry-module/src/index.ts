import {
  type ExternalRollPayload,
  buildLauncherQuery,
  createMockExternalRoll,
  isExternalRollMessage,
  isExternalRollPayload
} from "@dicewatcher/shared";

const MODULE_ID = "dicewatcher";
const LAUNCHER_PANEL_ID = "dicewatcher-launcher-panel";
const DEFAULT_WEB_APP_URL = "http://localhost:5173";
const DRAG_STORAGE_KEY = `${MODULE_ID}.launcher-position`;

type RollAcceptanceResult =
  | {
      accepted: true;
      payload: ExternalRollPayload;
    }
  | {
      accepted: false;
      reason: string;
    };

type BridgeEventStatus = "idle" | "accepted" | "rejected";

type BridgeEventState = {
  status: BridgeEventStatus;
  title: string;
  detail: string;
};

type LauncherPosition = {
  left: number;
  top: number;
};

let launcherWindow: Window | null = null;
let bridgeEventState: BridgeEventState = {
  status: "idle",
  title: "Awaiting roll",
  detail: "Open the camera app, then send a captured or test roll to see bridge status here."
};

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
    default: DEFAULT_WEB_APP_URL
  });
}

function getConfiguredWebAppUrl() {
  return (
    (game.settings.get(MODULE_ID, "webAppUrl") as string | undefined) ??
    DEFAULT_WEB_APP_URL
  );
}

function getConfiguredWebAppOrigin() {
  return new URL(getConfiguredWebAppUrl()).origin;
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
  const baseUrl = new URL(getConfiguredWebAppUrl());

  baseUrl.search = buildLauncherQuery(getSessionDetails()).toString();

  return baseUrl.toString();
}

function logDebug(message: string, context?: unknown) {
  const debugLoggingEnabled = Boolean(
    game.settings.get(MODULE_ID, "debugLogging")
  );

  if (!debugLoggingEnabled) {
    return;
  }

  console.info(message, context);
}

function loadLauncherPosition(): LauncherPosition | null {
  const rawValue = window.localStorage.getItem(DRAG_STORAGE_KEY);

  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<LauncherPosition>;

    if (
      typeof parsed.left !== "number" ||
      typeof parsed.top !== "number" ||
      Number.isNaN(parsed.left) ||
      Number.isNaN(parsed.top)
    ) {
      return null;
    }

    return {
      left: parsed.left,
      top: parsed.top
    };
  } catch {
    return null;
  }
}

function saveLauncherPosition(position: LauncherPosition) {
  window.localStorage.setItem(DRAG_STORAGE_KEY, JSON.stringify(position));
}

function clampPanelPosition(position: LauncherPosition, panel: HTMLElement) {
  const maxLeft = Math.max(16, window.innerWidth - panel.offsetWidth - 16);
  const maxTop = Math.max(16, window.innerHeight - panel.offsetHeight - 16);

  return {
    left: Math.min(Math.max(16, position.left), maxLeft),
    top: Math.min(Math.max(16, position.top), maxTop)
  };
}

function applyLauncherPosition(panel: HTMLElement, position: LauncherPosition) {
  const clampedPosition = clampPanelPosition(position, panel);

  panel.style.left = `${clampedPosition.left}px`;
  panel.style.top = `${clampedPosition.top}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
}

function updateBridgeStatus(state: BridgeEventState) {
  bridgeEventState = state;

  const statusCard = document.querySelector<HTMLElement>(
    `#${LAUNCHER_PANEL_ID} [data-role="bridge-status"]`
  );

  if (!statusCard) {
    return;
  }

  statusCard.style.borderColor =
    state.status === "accepted"
      ? "rgba(157, 226, 176, 0.28)"
      : state.status === "rejected"
        ? "rgba(255, 145, 123, 0.28)"
        : "rgba(255,255,255,0.08)";
  statusCard.style.background =
    state.status === "accepted"
      ? "rgba(157, 226, 176, 0.08)"
      : state.status === "rejected"
        ? "rgba(255, 145, 123, 0.08)"
        : "rgba(255,255,255,0.04)";

  const titleNode = statusCard.querySelector<HTMLElement>('[data-role="status-title"]');
  const detailNode = statusCard.querySelector<HTMLElement>('[data-role="status-detail"]');

  if (titleNode) {
    titleNode.textContent = state.title;
    titleNode.style.color =
      state.status === "accepted"
        ? "#9de2b0"
        : state.status === "rejected"
          ? "#ffb39e"
          : "#f5f0e8";
  }

  if (detailNode) {
    detailNode.textContent = state.detail;
  }

  const toneNode = statusCard.querySelector<HTMLElement>('[data-role="status-tone"]');

  if (toneNode) {
    toneNode.textContent =
      state.status === "accepted"
        ? "Ready to send"
        : state.status === "rejected"
          ? "Needs review"
          : "Waiting for app";
    toneNode.style.color =
      state.status === "accepted"
        ? "#9de2b0"
        : state.status === "rejected"
          ? "#ffd38a"
          : "#bcb7af";
  }
}

function reportRejectedRoll(reason: string, context?: unknown) {
  console.warn(`[DiceWatcher] Rejected external roll. ${reason}`, context);
  updateBridgeStatus({
    status: "rejected",
    title: "Last roll rejected",
    detail: reason
  });
}

function validateIncomingRoll(payload: unknown): RollAcceptanceResult {
  if (!isExternalRollPayload(payload)) {
    return {
      accepted: false,
      reason: "Invalid external roll payload."
    };
  }

  const session = getSessionDetails();

  if (payload.sessionId !== session.sessionId) {
    return {
      accepted: false,
      reason: `Session mismatch. Expected ${session.sessionId}, received ${payload.sessionId}.`
    };
  }

  if (session.userId && payload.userId !== session.userId) {
    return {
      accepted: false,
      reason: `User mismatch. Expected ${session.userId}, received ${payload.userId ?? "none"}.`
    };
  }

  return {
    accepted: true,
    payload
  };
}

export function handleExternalRoll(payload: unknown) {
  const validation = validateIncomingRoll(payload);

  if (!validation.accepted) {
    reportRejectedRoll(validation.reason, payload);
    return;
  }

  const typedPayload = validation.payload;

  logDebug("[DiceWatcher] Received external roll payload.", typedPayload);
  updateBridgeStatus({
    status: "accepted",
    title: `Last roll accepted: d6 = ${typedPayload.total}`,
    detail: `Session ${typedPayload.sessionId}${typedPayload.corrected ? " with review confirmation" : ""}.`
  });

  void ChatMessage?.create({
    content: `<p><strong>DiceWatcher</strong> received an external d6 roll: ${typedPayload.total}</p>`
  });
}

function openLauncher() {
  launcherWindow = window.open(
    getLauncherUrl(),
    "dicewatcher-launcher",
    "popup=yes,width=520,height=900,resizable=yes,scrollbars=yes"
  );
}

function enableLauncherDragging(panel: HTMLElement, dragHandle: HTMLElement) {
  let pointerId: number | null = null;
  let originX = 0;
  let originY = 0;
  let startLeft = 0;
  let startTop = 0;

  dragHandle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }

    const rect = panel.getBoundingClientRect();
    pointerId = event.pointerId;
    originX = event.clientX;
    originY = event.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    dragHandle.setPointerCapture(event.pointerId);
    panel.style.cursor = "grabbing";
    dragHandle.style.cursor = "grabbing";
    event.preventDefault();
  });

  dragHandle.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId) {
      return;
    }

    const nextPosition = {
      left: startLeft + (event.clientX - originX),
      top: startTop + (event.clientY - originY)
    };

    applyLauncherPosition(panel, nextPosition);
  });

  function finishDrag(event: PointerEvent) {
    if (pointerId !== event.pointerId) {
      return;
    }

    pointerId = null;
    panel.style.cursor = "default";
    dragHandle.style.cursor = "grab";
    dragHandle.releasePointerCapture(event.pointerId);
    saveLauncherPosition({
      left: panel.offsetLeft,
      top: panel.offsetTop
    });
  }

  dragHandle.addEventListener("pointerup", finishDrag);
  dragHandle.addEventListener("pointercancel", finishDrag);

  window.addEventListener("resize", () => {
    applyLauncherPosition(panel, {
      left: panel.offsetLeft,
      top: panel.offsetTop
    });
    saveLauncherPosition({
      left: panel.offsetLeft,
      top: panel.offsetTop
    });
  });
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
  panel.style.width = "320px";
  panel.style.padding = "16px";
  panel.style.borderRadius = "16px";
  panel.style.background = "rgba(20, 21, 27, 0.94)";
  panel.style.border = "1px solid rgba(255,255,255,0.12)";
  panel.style.boxShadow = "0 20px 48px rgba(0,0,0,0.35)";
  panel.style.color = "#f5f0e8";
  panel.style.fontFamily = "system-ui, sans-serif";
  panel.style.userSelect = "none";
  panel.style.backdropFilter = "blur(14px)";

  const session = getSessionDetails();
  const launcherUrl = getLauncherUrl();
  const launcherOrigin = getConfiguredWebAppOrigin();

  panel.innerHTML = `
    <div data-role="drag-handle" style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin:-4px -4px 14px; padding:4px; cursor:grab;">
      <div>
        <div style="font-size:12px; letter-spacing:0.12em; text-transform:uppercase; color:#ffb98d; margin-bottom:8px;">
          DiceWatcher
        </div>
        <div style="font-size:20px; font-weight:700; margin-bottom:4px;">
          Bridge Launcher
        </div>
        <div style="font-size:12px; line-height:1.4; color:#bcb7af;">
          Open the camera app, test the bridge, and watch the latest roll state.
        </div>
      </div>
      <div style="padding:6px 8px; border-radius:999px; border:1px dashed rgba(255,255,255,0.18); font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#bcb7af;">
        Drag
      </div>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px;">
      <div style="padding:10px; border-radius:12px; background:rgba(255,255,255,0.06);">
        <div style="font-size:12px; color:#ffb98d; text-transform:uppercase; margin-bottom:4px;">Session</div>
        <div style="font-size:13px; line-height:1.35;">${session.sessionId}</div>
      </div>
      <div style="padding:10px; border-radius:12px; background:rgba(255,255,255,0.06);">
        <div style="font-size:12px; color:#ffb98d; text-transform:uppercase; margin-bottom:4px;">User</div>
        <div style="font-size:13px; line-height:1.35;">${session.userLabel ?? session.userId ?? "Unpaired"}</div>
      </div>
    </div>
    <div data-role="bridge-status" style="margin-bottom:12px; padding:12px; border-radius:14px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.04);">
      <div data-role="status-tone" style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#bcb7af; margin-bottom:6px;">Waiting for app</div>
      <div data-role="status-title" style="font-size:14px; font-weight:700; margin-bottom:4px;">${bridgeEventState.title}</div>
      <div data-role="status-detail" style="font-size:12px; line-height:1.4; color:#bcb7af;">${bridgeEventState.detail}</div>
    </div>
    <div style="margin-bottom:12px; padding:10px; border-radius:12px; background:linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.03)); border:1px solid rgba(255,255,255,0.08);">
      <div style="font-size:12px; color:#ffb98d; text-transform:uppercase; margin-bottom:6px;">Capture flow</div>
      <div style="font-size:12px; line-height:1.45; color:#d8d4ce;">1. Open the web app. 2. Capture or upload one die. 3. Review the result. 4. Send it back here.</div>
    </div>
    <div style="display:flex; gap:8px; margin-bottom:8px;">
      <button type="button" data-action="open" style="flex:1; border:0; border-radius:999px; padding:10px 12px; font:inherit; font-weight:700; cursor:pointer; background:linear-gradient(135deg,#ffd38a 0%,#ff9f6b 100%); color:#1a1612;">
        Open Web App
      </button>
      <button type="button" data-action="test-roll" style="flex:1; border:1px solid rgba(255,255,255,0.14); border-radius:999px; padding:10px 12px; font:inherit; font-weight:700; cursor:pointer; background:rgba(255,255,255,0.06); color:#f5f0e8;">
        Send Test Roll
      </button>
    </div>
    <div style="padding:10px; border-radius:12px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08);">
      <div style="font-size:12px; color:#ffb98d; text-transform:uppercase; margin-bottom:4px;">Web app</div>
      <div style="font-size:12px; line-height:1.4; color:#d8d4ce; word-break:break-all;">${launcherOrigin}</div>
      <div style="font-size:11px; line-height:1.4; color:#8f8a84; margin-top:4px;">Launch URL includes the active session and Foundry origin pairing.</div>
    </div>
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

  const savedPosition = loadLauncherPosition();

  if (savedPosition) {
    applyLauncherPosition(panel, savedPosition);
  }

  const dragHandle = panel.querySelector<HTMLElement>('[data-role="drag-handle"]');

  if (dragHandle) {
    enableLauncherDragging(panel, dragHandle);
  }

  updateBridgeStatus(bridgeEventState);
}

function registerWindowBridge() {
  window.addEventListener("message", (event) => {
    if (!isExternalRollMessage(event.data)) {
      return;
    }

    if (event.origin !== getConfiguredWebAppOrigin()) {
      reportRejectedRoll(
        `Origin mismatch. Expected ${getConfiguredWebAppOrigin()}, received ${event.origin}.`,
        event.data
      );
      return;
    }

    if (launcherWindow && event.source !== launcherWindow) {
      reportRejectedRoll("Message source did not match the active launcher window.");
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
