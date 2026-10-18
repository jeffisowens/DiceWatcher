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
