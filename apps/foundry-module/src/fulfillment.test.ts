import type { ProtocolMessage, RollFulfillment } from "@dicewatcher/shared";
import { describe, expect, it, vi } from "vitest";
import {
  METHOD_ID,
  type PendingSlot,
  ResolverBridge,
  type ResolverLike,
  readPendingSlots,
  requestedDice
} from "./fulfillment";

const slot = (denomination: string, method = METHOD_ID): PendingSlot => ({
  method,
  denomination
});

function fakeResolver(id: string, slots: PendingSlot[]) {
  const registered: [string, string, number][] = [];
  const resolver: ResolverLike = {
    id,
    fulfillable: new Map(
      slots.map((s, index) => [
        `t${index}`,
        { method: s.method, term: { denomination: s.denomination, number: 1 } }
      ])
    ),
    registerResult: (method, denomination, value) => {
      registered.push([method, denomination, value]);
      return true;
    }
  };

  return { resolver, registered };
}

function setup(initiallyPaired = true) {
  const sent: ProtocolMessage[] = [];
  const notify = vi.fn();
  let paired = initiallyPaired;
  const bridge = new ResolverBridge({
    send: (message) => {
      if (paired) sent.push(message);
      return paired;
    },
    notify
  });

  return {
    bridge,
    sent,
    notify,
    pair: () => {
      paired = true;
    }
  };
}

const fulfillment = (requestId: string, values: number[]): RollFulfillment => ({
  v: 1,
  type: "roll-fulfillment",
  requestId,
  dice: values.map((value) => ({
    kind: "d6",
    value,
    confidence: 0,
    corrected: true
  }))
});

describe("requestedDice", () => {
  it("counts DiceWatcher d6 slots and skips everything else", () => {
    expect(
      requestedDice([slot("d6"), slot("d6"), slot("d6", "manual"), slot("d20")])
    ).toEqual([{ kind: "d6", count: 2 }]);
  });

  it("returns nothing when no slot is DiceWatcher's", () => {
    expect(requestedDice([slot("d6", "manual")])).toEqual([]);
  });
});

describe("readPendingSlots", () => {
  it("expands fulfillable terms by their number of dice", () => {
    const resolver: ResolverLike = {
      id: "a",
      fulfillable: new Map([
        ["t0", { method: METHOD_ID, term: { denomination: "d6", number: 3 } }]
      ]),
      registerResult: () => true
    };

    expect(readPendingSlots(resolver)).toHaveLength(3);
  });
});

describe("ResolverBridge", () => {
  it("sends one request per resolver render with DiceWatcher dice", () => {
    const { bridge, sent } = setup();
    const { resolver } = fakeResolver("a", [slot("d6"), slot("d6")]);

    bridge.onRender(resolver);
    bridge.onRender(resolver);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: "roll-request",
      dice: [{ kind: "d6", count: 2 }]
    });
  });

  it("ignores resolvers with no DiceWatcher dice", () => {
    const { bridge, sent } = setup();
    bridge.onRender(fakeResolver("a", [slot("d6", "manual")]).resolver);
    expect(sent).toEqual([]);
  });

  it("feeds a matching fulfillment into the resolver without cancelling", () => {
    const { bridge, sent } = setup();
    const { resolver, registered } = fakeResolver("a", [
      slot("d6"),
      slot("d6")
    ]);

    bridge.onRender(resolver);
    const { requestId } = sent[0] as { requestId: string };
    bridge.onMessage(fulfillment(requestId, [3, 5]));
    bridge.onClose(resolver);

    expect(registered).toEqual([
      [METHOD_ID, "d6", 3],
      [METHOD_ID, "d6", 5]
    ]);
    expect(sent.slice(1)).toEqual([
      { v: 1, type: "roll-closed", requestId, outcome: "fulfilled" }
    ]);
    expect(bridge.current).toBeNull();
  });

  it("rejects a fulfillment with the wrong number of dice", () => {
    const { bridge, sent } = setup();
    const { resolver, registered } = fakeResolver("a", [
      slot("d6"),
      slot("d6")
    ]);

    bridge.onRender(resolver);
    const { requestId } = sent[0] as { requestId: string };
    bridge.onMessage(fulfillment(requestId, [3]));

    expect(registered).toEqual([]);
    expect(sent[1]).toMatchObject({ type: "roll-rejected", requestId });
  });

  it("rejects a fulfillment for an unknown request", () => {
    const { bridge, sent } = setup();
    bridge.onMessage(fulfillment("nope", [3]));
    expect(sent[0]).toMatchObject({ type: "roll-rejected", requestId: "nope" });
  });

  it("cancels the request when the resolver closes unfulfilled", () => {
    const { bridge, sent } = setup();
    const { resolver } = fakeResolver("a", [slot("d6")]);

    bridge.onRender(resolver);
    bridge.onClose(resolver);

    expect(sent[1]).toMatchObject({
      type: "roll-closed",
      requestId: (sent[0] as { requestId: string }).requestId,
      outcome: "cancelled"
    });
  });

  it("warns when no camera is paired and resends once one pairs", () => {
    const { bridge, sent, notify, pair } = setup(false);

    bridge.onRender(fakeResolver("a", [slot("d6")]).resolver);
    expect(notify).toHaveBeenCalledWith("warn", expect.any(String));
    expect(sent).toEqual([]);

    pair();
    bridge.onPaired();
    expect(sent).toMatchObject([{ type: "roll-request" }]);
  });
});

describe("readPendingSlots from the form", () => {
  it("reads method and denomination from the input or its ancestors", () => {
    const form = {
      querySelectorAll: () => [
        fakeInput("", { method: METHOD_ID }, { denomination: "d6" }),
        fakeInput("4", { method: METHOD_ID }, { denomination: "d6" }),
        fakeInput("", { method: METHOD_ID }, { denomination: "d6" })
      ]
    } as unknown as HTMLElement;

    expect(
      readPendingSlots({ id: "a", element: form, registerResult: () => true })
    ).toEqual([slot("d6"), slot("d6")]);
  });
});

function fakeInput(
  value: string,
  ...datasets: Record<string, string>[]
): HTMLInputElement {
  return {
    value,
    closest: (selector: string) => {
      const key = selector === "[data-method]" ? "method" : "denomination";
      const dataset = datasets.find((d) => key in d);
      return dataset ? { dataset } : null;
    }
  } as unknown as HTMLInputElement;
}

describe("ResolverBridge sync on ping", () => {
  const ping = (requestId: string | null): ProtocolMessage => ({
    v: 1,
    type: "ping",
    requestId
  });

  it("resends the open request to a camera that missed it", () => {
    const { bridge, sent } = setup();
    bridge.onRender(fakeResolver("a", [slot("d6")]).resolver);

    bridge.onMessage(ping(null));

    expect(sent.map((message) => message.type)).toEqual([
      "roll-request",
      "roll-request"
    ]);
  });

  it("stays quiet when the camera shows the open request", () => {
    const { bridge, sent } = setup();
    bridge.onRender(fakeResolver("a", [slot("d6")]).resolver);
    const { requestId } = sent[0] as { requestId: string };

    bridge.onMessage(ping(requestId));
    bridge.onMessage(ping(null));
    sent.length = 0;
    bridge.onMessage(ping(requestId));

    expect(sent).toEqual([]);
  });

  it("repeats how a request the camera still shows was closed", () => {
    const { bridge, sent } = setup();
    const { resolver } = fakeResolver("a", [slot("d6")]);
    bridge.onRender(resolver);
    const { requestId } = sent[0] as { requestId: string };
    bridge.onMessage(fulfillment(requestId, [4]));
    sent.length = 0;

    bridge.onMessage(ping(requestId));
    bridge.onMessage(ping("unknown"));

    expect(sent).toEqual([
      { v: 1, type: "roll-closed", requestId, outcome: "fulfilled" },
      { v: 1, type: "roll-closed", requestId: "unknown", outcome: "cancelled" }
    ]);
  });
});
