import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { parseTaskMarkdown, serializeTaskMarkdown } from "../../src/archive";

const dotnet = process.env.DOTNET_PATH ?? "dotnet";
const available = (() => {
  try { execFileSync(dotnet, ["--version"], { stdio: "pipe" }); return true; }
  catch { return false; }
})();

describe.skipIf(!available)("Windows C# / TypeScript strict v1 compatibility", () => {
  test("title-only, Markdown, Unicode and control-character fixtures round-trip byte for byte", () => {
    execFileSync(dotnet, ["build", "desktop/windows/CaptureCore.Tests", "-c", "Release"], { stdio: "pipe" });
    for (const index of [0, 1, 2]) {
      const source = execFileSync(dotnet, ["desktop/windows/CaptureCore.Tests/bin/Release/net8.0/CaptureCore.Tests.dll", "--fixture", String(index)], { encoding: "utf8" });
      const task = parseTaskMarkdown(source);
      expect(serializeTaskMarkdown(task)).toBe(source);
      expect(task.id).toBe(`desktop-fixture-${index}`);
      expect(task.events.map(({ kind }) => kind)).toEqual(["created"]);
      expect(task.groupId).toBeNull();
      expect(task.events[0]?.timezone).toBe("Asia/Shanghai");
      if (index === 0) expect(task.notes).toBeUndefined();
      else expect(task.notes).toBeTruthy();
    }
  }, 60_000);
});
