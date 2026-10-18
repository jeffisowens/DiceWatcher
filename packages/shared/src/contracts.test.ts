import { describe, expect, it } from "vitest";
import {
  buildLauncherQuery,
  createExternalRoll,
  createExternalRollMessage,
  isExternalRollMessage,
  isExternalRollPayload,
  parseLauncherSession
} from "./contracts";

const validRoll = () =>
  createExternalRoll({ sessionId: "s1", userId: "u1", value: 4 });

describe("isExternalRollPayload", () => {
  it("accepts a roll built by createExternalRoll", () => {
    expect(isExternalRollPayload(validRoll())).toBe(true);
  });

  it.each([0, 7, 3.5, Number.NaN])("rejects a d6 value of %s", (value) => {
    const roll = validRoll();
    roll.dice[0].value = value;
    roll.total = value;
    expect(isExternalRollPayload(roll)).toBe(false);
  });

  it("rejects a total that does not match the dice", () => {
    expect(isExternalRollPayload({ ...validRoll(), total: 5 })).toBe(false);
  });

  it("rejects confidence outside 0..1", () => {
    const roll = validRoll();
    roll.dice[0].confidence = 1.5;
    expect(isExternalRollPayload(roll)).toBe(false);
  });

  it("rejects a roll with no dice", () => {
    expect(isExternalRollPayload({ ...validRoll(), dice: [], total: 0 })).toBe(
      false
    );
  });

  it("rejects non-objects", () => {
    expect(isExternalRollPayload(null)).toBe(false);
    expect(isExternalRollPayload("roll")).toBe(false);
  });
});

describe("createExternalRoll", () => {
  it("carries recognizer confidence and the corrected flag", () => {
    const roll = createExternalRoll({
      sessionId: "s1",
      value: 2,
      confidence: 0.62,
      corrected: true
    });
    expect(roll.dice[0].confidence).toBe(0.62);
    expect(roll.corrected).toBe(true);
    expect(roll.total).toBe(2);
  });
});

describe("isExternalRollMessage", () => {
  it("accepts a wrapped valid roll", () => {
    expect(isExternalRollMessage(createExternalRollMessage(validRoll()))).toBe(
      true
    );
  });

  it("rejects an unknown message type", () => {
    expect(isExternalRollMessage({ type: "other", payload: validRoll() })).toBe(
      false
    );
  });
});

describe("launcher query", () => {
  it("round-trips a session through URL parameters", () => {
    const session = {
      sessionId: "dicewatcher-u1",
      userId: "u1",
      userLabel: "Jo & Co",
      foundryOrigin: "https://foundry.example"
    };
    expect(parseLauncherSession(buildLauncherQuery(session))).toEqual(session);
  });
});
