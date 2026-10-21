import {
  type DieKind,
  fulfillmentMatchesRequest,
  generateSecret,
  isDieKind,
  PROTOCOL_VERSION,
  type ProtocolMessage,
  type RollClosed,
  type RollFulfillment,
  type RollRequest
} from "@dicewatcher/shared";

// Bridges Foundry's RollResolver to the camera: each resolver that is waiting
// on DiceWatcher dice becomes one roll-request, and a matching fulfillment is
// fed back into that resolver (spec §3.1).

export const METHOD_ID = "dicewatcher";

// One unfilled result a resolver is waiting on.
export type PendingSlot = { method: string; denomination: string };

// The subset of RollResolver this bridge uses.
export type ResolverLike = {
  id: string;
  element?: HTMLElement | null;
  fulfillable?: Map<
    string,
    { method: string; term: { denomination: string; number?: number } }
  >;
  registerResult(method: string, denomination: string, result: number): boolean;
};

export type BridgeEvents = {
  send(message: ProtocolMessage): boolean;
  notify(level: "info" | "warn", text: string): void;
};

export function registerFulfillmentMethod() {
  CONFIG.Dice.fulfillment.methods[METHOD_ID] = {
    label: "DiceWatcher (camera)",
    icon: '<i class="fa-solid fa-camera"></i>',
    interactive: true
  };
}

// Turns the resolver's open slots into the dice to ask the camera for. Only
// slots routed to DiceWatcher with a kind the camera supports are included;
// anything else stays for the player to fill by hand.
export function requestedDice(slots: PendingSlot[]): RollRequest["dice"] {
  const counts = new Map<DieKind, number>();

  for (const { method, denomination } of slots) {
    if (method === METHOD_ID && isDieKind(denomination)) {
      counts.set(denomination, (counts.get(denomination) ?? 0) + 1);
    }
  }

  return [...counts].map(([kind, count]) => ({ kind, count }));
}

// Reads the open slots from the resolver. Foundry's own list of fulfillable
// terms comes first; the rendered form (one empty input per result, with its
// method and denomination on the input or an enclosing element) is the
// fallback.
export function readPendingSlots(resolver: ResolverLike): PendingSlot[] {
  const slots: PendingSlot[] = [];

  for (const { method, term } of resolver.fulfillable?.values() ?? []) {
    for (let index = 0; index < (term.number ?? 1); index += 1) {
      slots.push({ method, denomination: term.denomination });
    }
  }

  if (slots.length > 0) {
    return slots;
  }

  const inputs =
    resolver.element?.querySelectorAll<HTMLInputElement>("input") ?? [];

  return Array.from(inputs)
    .filter((input) => input.value === "")
    .map((input) => ({
      method: input.closest<HTMLElement>("[data-method]")?.dataset.method ?? "",
      denomination:
        input.closest<HTMLElement>("[data-denomination]")?.dataset
          .denomination ?? ""
    }))
    .filter((slot) => slot.method !== "" && slot.denomination !== "");
}

function sameDice(a: RollRequest["dice"], b: RollRequest["dice"]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (term, index) =>
        term.kind === b[index]?.kind && term.count === b[index]?.count
    )
  );
}

type OpenRequest = { resolver: ResolverLike; request: RollRequest };

export class ResolverBridge {
  #events: BridgeEvents;
  #open = new Map<string, OpenRequest>();
  // Outcomes of recently closed requests, by request id.
  #closed = new Map<string, RollClosed["outcome"]>();

  constructor(events: BridgeEvents) {
    this.#events = events;
  }

  // The newest request the camera should be showing, if any.
  get current(): RollRequest | null {
    return [...this.#open.values()].at(-1)?.request ?? null;
  }

  // Called on every render of a RollResolver.
  onRender(resolver: ResolverLike) {
    const dice = requestedDice(readPendingSlots(resolver));
    const existing = this.#open.get(resolver.id);

    if (existing && sameDice(existing.request.dice, dice)) {
      return;
    }

    if (existing) {
      this.#close(resolver.id, "cancelled");
    }

    if (dice.length === 0) {
      return;
    }

    const request: RollRequest = {
      v: PROTOCOL_VERSION,
      type: "roll-request",
      requestId: generateSecret(8),
      dice
    };

    this.#open.set(resolver.id, { resolver, request });

    if (!this.#events.send(request)) {
      this.#events.notify(
        "warn",
        "DiceWatcher: no camera is paired. Pair one from the DiceWatcher panel, or type the results."
      );
    }
  }

  onClose(resolver: ResolverLike) {
    this.#close(resolver.id, "cancelled");
  }

  // A camera just paired: show it whatever is already waiting.
  onPaired() {
    const request = this.current;

    if (request) {
      this.#events.send(request);
    }
  }

  onMessage(message: ProtocolMessage) {
    if (message.type === "roll-fulfillment") {
      this.#fulfill(message);
    } else if (message.type === "ping") {
      this.#sync(message.requestId);
    }
  }

  // The camera reports what it is showing on every ping. Resend a request it
  // missed, and repeat the outcome of one it is still showing after it closed.
  #sync(showing: string | null) {
    const current = this.current;

    if (showing && showing !== current?.requestId) {
      this.#events.send({
        v: PROTOCOL_VERSION,
        type: "roll-closed",
        requestId: showing,
        outcome: this.#closed.get(showing) ?? "cancelled"
      });
    }

    if (current && showing !== current.requestId) {
      this.#events.send(current);
    }
  }

  #fulfill(fulfillment: RollFulfillment) {
    const entry = [...this.#open].find(
      ([, open]) => open.request.requestId === fulfillment.requestId
    );

    if (!entry) {
      this.#reject(fulfillment.requestId, "That roll is no longer waiting.");
      return;
    }

    const [resolverId, { resolver, request }] = entry;

    if (!fulfillmentMatchesRequest(request, fulfillment)) {
      this.#reject(
        fulfillment.requestId,
        "The dice sent do not match the dice requested."
      );
      return;
    }

    // Close the request first: filling the last slot closes the resolver,
    // and that close is not a cancellation.
    this.#close(resolverId, "fulfilled");

    for (const die of fulfillment.dice) {
      if (!resolver.registerResult(METHOD_ID, die.kind, die.value)) {
        this.#events.notify(
          "warn",
          `DiceWatcher: Foundry did not accept a ${die.kind} result of ${die.value}.`
        );
      }
    }

    const corrected = fulfillment.dice.filter((die) => die.corrected).length;

    this.#events.notify(
      "info",
      `DiceWatcher: received ${fulfillment.dice.map((die) => die.value).join(", ")}${corrected ? ` (${corrected} entered or corrected by hand)` : ""}.`
    );
  }

  #reject(requestId: string, reason: string) {
    this.#events.send({
      v: PROTOCOL_VERSION,
      type: "roll-rejected",
      requestId,
      reason
    });
  }

  #close(resolverId: string, outcome: RollClosed["outcome"]) {
    const open = this.#open.get(resolverId);

    if (!open) {
      return;
    }

    this.#open.delete(resolverId);
    this.#closed.set(open.request.requestId, outcome);

    if (this.#closed.size > 20) {
      this.#closed.delete(this.#closed.keys().next().value ?? "");
    }

    this.#events.send({
      v: PROTOCOL_VERSION,
      type: "roll-closed",
      requestId: open.request.requestId,
      outcome
    });
  }
}
