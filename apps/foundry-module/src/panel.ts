import type { RollRequest } from "@dicewatcher/shared";
import QRCode from "qrcode";
import type { HostState } from "./pairing-host";

// The floating DiceWatcher panel in Foundry: pairing controls, the QR code
// and what the camera is being asked for. Replaced by an ApplicationV2 status
// panel in M4.

const PANEL_ID = "dicewatcher-panel";
const DRAG_STORAGE_KEY = "dicewatcher.launcher-position";

type LauncherPosition = {
  left: number;
  top: number;
};

export type PanelActions = {
  pairPhone(): void;
  useWebcam(): void;
  disconnect(): void;
};

export type PanelView = {
  state: HostState;
  paired: boolean;
  request: RollRequest | null;
};

export class Panel {
  #body: HTMLElement;
  #actions: PanelActions;
  #qrFor: string | null = null;
  #expiryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(actions: PanelActions) {
    this.#actions = actions;
    document.getElementById(PANEL_ID)?.remove();

    const panel = document.createElement("aside");
    panel.id = PANEL_ID;
    panel.style.position = "fixed";
    panel.style.right = "16px";
    panel.style.bottom = "16px";
    panel.style.zIndex = "80";
    panel.style.width = "300px";
    panel.style.padding = "16px";
    panel.style.borderRadius = "16px";
    panel.style.background = "rgba(20, 21, 27, 0.94)";
    panel.style.border = "1px solid rgba(255,255,255,0.12)";
    panel.style.boxShadow = "0 20px 48px rgba(0,0,0,0.35)";
    panel.style.color = "#f5f0e8";
    panel.style.fontFamily = "system-ui, sans-serif";
    panel.style.userSelect = "none";
    panel.innerHTML = `
      <div data-role="drag-handle" style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin:-4px -4px 12px; padding:4px; cursor:grab;">
        <div style="font-size:12px; letter-spacing:0.12em; text-transform:uppercase; color:#ffb98d;">DiceWatcher</div>
        <div style="padding:4px 8px; border-radius:999px; border:1px dashed rgba(255,255,255,0.18); font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#bcb7af;">Drag</div>
      </div>
      <div data-role="body"></div>
    `;
    panel.addEventListener("click", (event) => {
      const action = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-action]"
      )?.dataset.action;

      if (action === "pair-phone") this.#actions.pairPhone();
      if (action === "use-webcam") this.#actions.useWebcam();
      if (action === "disconnect") this.#actions.disconnect();
    });

    document.body.append(panel);
    this.#body =
      panel.querySelector<HTMLElement>('[data-role="body"]') ?? panel;

    const savedPosition = loadLauncherPosition();

    if (savedPosition) {
      applyLauncherPosition(panel, savedPosition);
    }

    const dragHandle = panel.querySelector<HTMLElement>(
      '[data-role="drag-handle"]'
    );

    if (dragHandle) {
      enableLauncherDragging(panel, dragHandle);
    }
  }

  render(view: PanelView) {
    const { state, paired, request } = view;
    const waiting = state.kind === "waiting" ? state : null;
    const status = paired
      ? {
          title: "Camera paired",
          detail:
            state.kind === "paired" && state.transport === "window"
              ? "Using this computer's webcam."
              : "Rolls routed to DiceWatcher go to your phone."
        }
      : waiting?.transport === "peer"
        ? {
            title: "Scan with your phone",
            detail: "Open the link on the phone you'll roll with."
          }
        : waiting
          ? {
              title: "Waiting for the camera window",
              detail: "Allow camera access in the popup."
            }
          : state.kind === "starting"
            ? { title: "Starting…", detail: "Contacting the pairing server." }
            : {
                title: "No camera paired",
                detail:
                  state.kind === "idle" && state.error
                    ? state.error
                    : "Pair a phone, or use this computer's webcam."
              };
    const requestLine = request
      ? request.dice.map((term) => `${term.count} ${term.kind}`).join(", ")
      : null;

    this.#body.innerHTML = `
      <div style="margin-bottom:12px; padding:10px; border-radius:12px; border:1px solid rgba(255,255,255,0.08); background:${paired ? "rgba(157, 226, 176, 0.08)" : "rgba(255,255,255,0.04)"};">
        <div style="font-size:14px; font-weight:700; margin-bottom:4px; color:${paired ? "#9de2b0" : "#f5f0e8"};">${escapeHtml(status.title)}</div>
        <div style="font-size:12px; line-height:1.4; color:#bcb7af;">${escapeHtml(status.detail)}</div>
        ${requestLine ? `<div style="margin-top:8px; font-size:13px;">Waiting for: <strong>${escapeHtml(requestLine)}</strong></div>` : ""}
      </div>
      ${
        waiting?.transport === "peer"
          ? `<div style="margin-bottom:12px; text-align:center;">
              <img data-role="qr" alt="Pairing QR code" style="width:220px; height:220px; border-radius:8px; background:#fff;" />
              <div data-role="expiry" style="font-size:12px; color:#bcb7af; margin-top:6px;"></div>
              <a href="${escapeHtml(waiting.pairingUrl)}" target="_blank" rel="noopener" style="display:block; margin-top:6px; font-size:11px; color:#ffb98d; word-break:break-all; user-select:text;">${escapeHtml(waiting.pairingUrl)}</a>
            </div>`
          : ""
      }
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${button("pair-phone", paired ? "Pair a different phone" : "Pair phone", true)}
        ${button("use-webcam", "Use this computer's webcam", false)}
        ${paired ? button("disconnect", "Disconnect", false) : ""}
      </div>
    `;

    this.#showQr(waiting?.transport === "peer" ? waiting.pairingUrl : null);
    this.#showExpiry(waiting?.transport === "peer" ? waiting.expiresAt : null);
  }

  #showQr(url: string | null) {
    const image =
      this.#body.querySelector<HTMLImageElement>('[data-role="qr"]');

    if (!url || !image) {
      this.#qrFor = null;
      return;
    }

    this.#qrFor = url;
    void QRCode.toDataURL(url, { margin: 1, width: 440 }).then((dataUrl) => {
      if (this.#qrFor === url) {
        image.src = dataUrl;
      }
    });
  }

  #showExpiry(expiresAt: number | null) {
    if (this.#expiryTimer) {
      clearInterval(this.#expiryTimer);
      this.#expiryTimer = null;
    }

    if (expiresAt === null) {
      return;
    }

    const update = () => {
      const node = this.#body.querySelector<HTMLElement>(
        '[data-role="expiry"]'
      );
      const seconds = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));

      if (node) {
        node.textContent =
          seconds > 0
            ? `Code expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
            : "Code expired. Click Pair phone for a new one.";
      }
    };

    update();
    this.#expiryTimer = setInterval(update, 1000);
  }
}

function button(action: string, label: string, primary: boolean): string {
  const style = primary
    ? "border:0; background:linear-gradient(135deg,#ffd38a 0%,#ff9f6b 100%); color:#1a1612;"
    : "border:1px solid rgba(255,255,255,0.14); background:rgba(255,255,255,0.06); color:#f5f0e8;";

  return `<button type="button" data-action="${action}" style="${style} border-radius:999px; padding:9px 12px; font:inherit; font-weight:700; cursor:pointer;">${escapeHtml(label)}</button>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
