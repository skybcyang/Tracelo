/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { addProgress, addTodo, createTask, setDueDate } from "../src/domain";
import { AGENT_RULE } from "../src/agent-rule";
import {
  GROUPS_FILE,
  createDefaultState,
  isTaskFile,
  normalizePluginState,
  parseTaskMarkdown,
  pickLatestValidBackup,
  serializeTaskMarkdown,
} from "../src/archive";

function task() {
  return addProgress(
    createTask(
      {
        title: "排查登录异常",
        groupId: "support",
        groupName: "客户支持",
        important: true,
        urgent: true,
      },
      new Date("2026-09-18T01:00:00.000Z"),
      "task-1",
      "event-1",
    ),
    "确认缓存键冲突",
    new Date("2026-09-18T02:00:00.000Z"),
    "event-2",
  );
}

describe("Markdown archive protocol", () => {
  it("round-trips one task while remaining readable as Markdown", () => {
    const source = serializeTaskMarkdown(task());

    expect(source).toContain("# 排查登录异常");
    expect(source).toContain("## 时间线");
    expect(source).toContain("确认缓存键冲突");
    expect(parseTaskMarkdown(source)).toEqual(task());
  });

  it("keeps v1 notes readable and round-trips optional details in the same archive", () => {
    const old = serializeTaskMarkdown(task());
    expect(parseTaskMarkdown(old)).toEqual(task());
    const withTodo = addTodo(task(), "核对退款路径", new Date("2026-09-18T03:00:00.000Z"), "todo-1", "event-3");
    const current = setDueDate(withTodo, "2026-09-30", new Date("2026-09-18T04:00:00.000Z"), "event-4");
    const source = serializeTaskMarkdown(current);
    expect(source).toContain("- 截止日期：2026-09-30");
    expect(source).toContain("- [ ] 核对退款路径");
    expect(parseTaskMarkdown(source)).toEqual(current);
    const invalid = source.replace('"dueDate": "2026-09-30"', '"dueDate": "2026-02-30"');
    expect(() => parseTaskMarkdown(invalid)).toThrow("任务文件格式无效");
  });

  it("rejects any hand-edited projection instead of silently accepting history changes", () => {
    const edited = serializeTaskMarkdown(task()).replace("确认缓存键冲突", "人工改写");
    expect(() => parseTaskMarkdown(edited)).toThrow("任务文件已被外部修改");
  });

  it("only recognizes fixed-id task notes and excludes archive support files", () => {
    expect(isTaskFile("工作记录/任务/task-1.md")).toBe(true);
    expect(isTaskFile("工作记录/任务/agent.md")).toBe(false);
    expect(isTaskFile(`工作记录/任务/${GROUPS_FILE}`)).toBe(false);
    expect(isTaskFile("工作记录/任务/readme.txt")).toBe(false);
  });

  it("falls back through invalid backups to the newest valid matching task", () => {
    const valid = serializeTaskMarkdown(task());
    const older = serializeTaskMarkdown({ ...task(), title: "更早版本" });
    const picked = pickLatestValidBackup("task-1", [
      { path: "2026-09-18/task-1.md", source: "broken" },
      { path: "2026-09-17/other.md", source: valid.replaceAll("task-1", "other") },
      { path: "2026-09-16/task-1.md", source: valid },
      { path: "2026-09-15/task-1.md", source: older },
    ]);

    expect(picked?.path).toBe("2026-09-16/task-1.md");
    expect(picked?.task.id).toBe("task-1");
  });
});

describe("plugin-only state", () => {
  it("stores drafts and independent view orders without formal task events", () => {
    expect(normalizePluginState({
      initialized: true,
      taskDirectory: "自定义/任务",
      drafts: { "task-1": "未提交内容" },
      orders: {
        group: { support: ["task-1"] },
        quadrant: { important_urgent: ["task-1"] },
      },
      viewMode: "quadrant",
    })).toMatchObject({
      initialized: true,
      taskDirectory: "自定义/任务",
      drafts: { "task-1": "未提交内容" },
      orders: {
        group: { support: ["task-1"] },
        quadrant: { important_urgent: ["task-1"] },
      },
      viewMode: "quadrant",
    });
    expect(createDefaultState().taskDirectory).toBe("工作记录/任务");
    expect(createDefaultState().pluginVersion).toBeNull();
  });

  it("ships an agent rule that forbids all direct archive mutations", () => {
    const rule = readFileSync("docs/templates/agent.md", "utf8");
    expect(AGENT_RULE).toBe(rule);
    expect(rule).toContain("禁止");
    expect(rule).toMatch(/创建|新建/);
    expect(rule).toContain("修改");
    expect(rule).toContain("删除");
    expect(rule).toContain("移动");
  });
});
