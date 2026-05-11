import { describe, expect, it } from "vitest";

import { en } from "./locales/en";
import { zh } from "./locales/zh";
import { resolveMessage } from "./resolve-message";

describe("resolveMessage", () => {
  it("returns zh copy when locale is zh", () => {
    expect(resolveMessage("fleet.refresh", "zh")).toBe(zh["fleet.refresh"]);
  });

  it("falls back to en when zh value is empty string", () => {
    const incomplete = { ...zh };
    incomplete["fleet.refresh"] = "";
    expect(resolveMessage("fleet.refresh", "zh", incomplete)).toBe(en["fleet.refresh"]);
  });
});
