import { describe, expect, it } from "vitest";
import { createDefaultState, normalizePluginState } from "../src/archive";

describe("card layout preference", () => {
  it("uses top alignment for new, legacy and invalid settings", () => {
    expect(createDefaultState().cardLayout).toBe("aligned");
    for (const value of [null, {}, { cardLayout: "unknown" }, { cardLayout: 1 }]) {
      expect(normalizePluginState(value).cardLayout).toBe("aligned");
    }
  });

  it("preserves either layout independently of view and presentation preferences", () => {
    for (const cardLayout of ["aligned", "masonry"]) {
      const state = normalizePluginState({ cardLayout, viewMode: "quadrant", presentationMode: true, boardZoom: 80 });
      expect(normalizePluginState(JSON.parse(JSON.stringify(state)))).toMatchObject({
        cardLayout, viewMode: "quadrant", presentationMode: true, boardZoom: 80,
      });
    }
  });
});
