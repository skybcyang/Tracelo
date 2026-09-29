import { describe, expect, it } from "vitest";
import { createDefaultState, normalizePluginState } from "../src/archive";

describe("card layout preference", () => {
  it("uses top alignment for new, legacy and invalid settings", () => {
    expect(createDefaultState().cardLayout).toBe("aligned");
    for (const value of [null, {}, { cardLayout: "unknown" }, { cardLayout: 1 }]) {
      expect(normalizePluginState(value).cardLayout).toBe("aligned");
    }
  });

  it("preserves presentation mode independently of layout and zoom", () => {
    for (const cardLayout of ["aligned", "masonry"]) {
      const state = normalizePluginState({ cardLayout, viewMode: "quadrant", presentationMode: true, boardZoom: 80 });
      expect(normalizePluginState(JSON.parse(JSON.stringify(state)))).toMatchObject({
        cardLayout, viewMode: "quadrant", boardZoom: 80, presentationMode: true,
      });
      expect(state).not.toHaveProperty('compactCards');
    }
  });

  it("defaults to compact and migrates the old compact preference only once", () => {
    for (const value of [null, {}, { compactCards: 'false' }]) {
      expect(normalizePluginState(value).presentationMode).toBe(false);
    }
    expect(createDefaultState().presentationMode).toBe(false);
    expect(normalizePluginState({ compactCards: true }).presentationMode).toBe(false);
    expect(normalizePluginState({ compactCards: false }).presentationMode).toBe(true);
    expect(normalizePluginState({ compactCards: false, presentationMode: false }).presentationMode).toBe(false);
    expect(normalizePluginState({ compactCards: true, presentationMode: true }).presentationMode).toBe(true);
  });
});
