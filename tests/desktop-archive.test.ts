import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseTaskMarkdown, serializeLegacyTaskMarkdown as serializeTaskMarkdown } from "../src/archive";
import { buildNewTask } from "../src/new-task-form";
import { QUADRANTS } from "../src/domain";

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
  test("shared full-field requests publish byte-identically through Swift for every quadrant", () => {
    execFileSync("swift", ["build", "--package-path", "desktop", "--product", "archive-fixture"], { stdio: "pipe" });
    const directory = mkdtempSync(join(tmpdir(), "tracelo-shared-swift-"));
    try {
      for (const quadrant of QUADRANTS) {
        let sequence = 0;
        const task = buildNewTask({ title: '共享 *任务* 😀', notes: '独立详情\n\n[参考](https://example.com)\n第二段', groupId: 'product', groupName: '产品研发',
          important: quadrant.important, urgent: quadrant.urgent, dueDate: '2026-10-01', todos: ['第一个待办', '第二个待办'], initialProgress: '已经开始推进' },
        new Date('2026-09-28T10:00:00.123Z'), () => `${quadrant.id}-${sequence++}`);
        const source = serializeTaskMarkdown(task);
        const publish = () => execFileSync('desktop/.build/debug/archive-fixture', ['--publish-shared', task.id, directory], { input: source, encoding: 'utf8' });
        expect(publish()).toBe(source);
        expect(publish()).toBe(source);
        const written = readFileSync(join(directory, `${task.id}.md`), 'utf8');
        expect(written).toBe(source);
        expect(parseTaskMarkdown(written)).toEqual(task);
        expect(task.events.map(event => event.kind)).toEqual(['created', 'due_changed', 'todo_added', 'todo_added', 'progress']);
      }
      expect(readdirSync(directory).length).toBe(4);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 60_000);
});
