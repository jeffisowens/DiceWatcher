import { describe, expect, it } from "vitest";
import { isDieKind } from "./contracts";

describe("isDieKind", () => {
  it("accepts supported kinds only", () => {
    expect(isDieKind("d6")).toBe(true);
    expect(isDieKind("d20")).toBe(false);
    expect(isDieKind(6)).toBe(false);
  });
});
