import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { parseTaskMarkdown, serializeLegacyTaskMarkdown as serializeTaskMarkdown } from "../../src/archive";
import { buildNewTask } from "../../src/new-task-form";

const dotnet = process.env.DOTNET_PATH ?? "dotnet";
const available = (() => {
  try { execFileSync(dotnet, ["--version"], { stdio: "pipe" }); return true; }
  catch { return false; }
})();

describe.skipIf(!available)("Windows C# / TypeScript strict v1 compatibility", () => {
  beforeAll(() => {
    execFileSync(dotnet, ["build", "desktop/windows/CaptureCore.Tests", "-c", "Release"], { stdio: "pipe" });
  }, 60_000);
  test("title-only, Markdown, Unicode and control-character fixtures round-trip byte for byte", () => {
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
  test("shared complete form publishes through C# unchanged and retries without overwriting", () => {
    const directory = mkdtempSync(join(tmpdir(), "tracelo-shared-form-"));
    try {
      let next = 0;
      const task = buildNewTask({ title: "完整创建", notes: "背景\n\n详情", groupId: "group-1", groupName: "产品", important: true, urgent: false,
        todos: ["检查界面", "确认文件"], dueDate: "2026-10-01", initialProgress: "已完成资料收集" }, new Date("2026-09-28T08:00:00.000Z"), () => `shared-form-${next++}`);
      const source = serializeTaskMarkdown(task);
      const payload = join(directory, "request.json");
      writeFileSync(payload, JSON.stringify({ id: task.id, markdown: source }));
      const publish = () => execFileSync(dotnet, ["desktop/windows/CaptureCore.Tests/bin/Release/net8.0/CaptureCore.Tests.dll", "--publish-request", payload, directory], { encoding: "utf8", stdio: "pipe" });
      publish();
      const target = join(directory, `${task.id}.md`);
      expect(readFileSync(target, "utf8")).toBe(source);
      expect(parseTaskMarkdown(readFileSync(target, "utf8"))).toEqual(task);
      publish();
      expect(readFileSync(target, "utf8")).toBe(source);
      writeFileSync(target, "existing file must survive");
      expect(publish).toThrow();
      expect(readFileSync(target, "utf8")).toBe("existing file must survive");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 60_000);
});
