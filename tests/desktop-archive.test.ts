import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { parseTaskMarkdown, serializeTaskMarkdown } from "../src/archive";

describe.skipIf(process.platform !== "darwin")("Swift / TypeScript v1 compatibility", () => {
  test("Swift title-only, notes and escaping fixtures pass strict parser byte for byte", () => {
    execFileSync("swift", ["build", "--package-path", "desktop", "--product", "archive-fixture"], { stdio: "pipe" });
    for (const index of [0, 1, 2]) {
      const source = execFileSync("desktop/.build/debug/archive-fixture", [String(index)], { encoding: "utf8" });
      const task = parseTaskMarkdown(source);
      expect(serializeTaskMarkdown(task)).toBe(source);
      expect(task.id).toBe(`desktop-fixture-${index}`);
      expect(task.events.map(({ kind }) => kind)).toEqual(["created"]);
      expect(task.groupId).toBeNull();
      expect(task.important).toBe(false);
      if (index === 0) expect(task.notes).toBeUndefined();
      else expect(task.notes).toBeTruthy();
    }
  }, 60_000);
});
