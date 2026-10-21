import { parseSignalingServer } from "@dicewatcher/shared";
import {
  ResolverBridge,
  type ResolverLike,
  readPendingSlots,
  registerFulfillmentMethod
} from "./fulfillment";
import { PairingHost } from "./pairing-host";
import { Panel } from "./panel";

const MODULE_ID = "dicewatcher";
const DEFAULT_WEB_APP_URL = "https://jeffisowens.github.io/DiceWatcher/";

function registerSettings() {
  game.settings.register(MODULE_ID, "debugLogging", {
    name: "Enable DiceWatcher debug logging",
    hint: "Logs pairing and roll messages to the browser console.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "webAppUrl", {
    name: "DiceWatcher camera app URL",
    hint: "Where the camera app is hosted. Change it only to use a local dev server or your own copy.",
    scope: "client",
    config: true,
    type: String,
    default: DEFAULT_WEB_APP_URL
  });

  game.settings.register(MODULE_ID, "signalingServer", {
    name: "Pairing server",
    hint: "A PeerJS server URL such as https://peer.example.com:443/. Leave blank to use the free PeerJS cloud server.",
    scope: "client",
    config: true,
    type: String,
    default: ""
  });
}

function setting<T>(key: string): T {
  return game.settings.get(MODULE_ID, key) as T;
}

function logDebug(message: string, context?: unknown) {
  if (setting<boolean>("debugLogging")) {
    console.info(message, context);
  }
}

function start() {
  const signalingSetting = setting<string>("signalingServer").trim();
  const signaling = signalingSetting
    ? parseSignalingServer(signalingSetting)
    : null;

  if (signalingSetting && !signaling) {
    ui.notifications?.warn(
      "DiceWatcher: the pairing server setting is not a valid URL; using PeerJS cloud."
    );
  }

  let panel: Panel | null = null;
  const render = () =>
    panel?.render({
      state: host.state,
      paired: host.paired,
      request: bridge.current
    });

  const bridge = new ResolverBridge({
    send: (message) => {
      logDebug("[DiceWatcher] Sending.", message);
      const sent = host.send(message);
      render();
      return sent;
    },
    notify: (level, text) => ui.notifications?.[level](text)
  });

  const host = new PairingHost({
    webAppUrl: setting<string>("webAppUrl") || DEFAULT_WEB_APP_URL,
    ...(signaling ? { signaling } : {}),
    user: { id: game.user?.id ?? "", name: game.user?.name ?? "" },
    log: logDebug,
    onState: (state) => {
      if (state.kind === "paired") {
        bridge.onPaired();
      }
      render();
    },
    onMessage: (message) => {
      logDebug("[DiceWatcher] Received.", message);
      bridge.onMessage(message);
      render();
    }
  });

  panel = new Panel({
    pairPhone: () => void host.startPeerPairing(),
    useWebcam: () => host.startWindowPairing(),
    disconnect: () => host.disconnect()
  });
  render();

  Hooks.on("renderRollResolver", (resolver: ResolverLike) => {
    logDebug("[DiceWatcher] Roll resolver rendered.", {
      slots: readPendingSlots(resolver),
      fulfillable: [...(resolver.fulfillable?.values() ?? [])]
    });
    bridge.onRender(resolver);
    render();
  });
  Hooks.on("closeRollResolver", (resolver: ResolverLike) => {
    bridge.onClose(resolver);
    render();
  });
}

Hooks.once("init", () => {
  registerSettings();
  registerFulfillmentMethod();
  console.info("[DiceWatcher] Module initialized.");
});

Hooks.once("ready", start);
