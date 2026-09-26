/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("final plugin surface", () => {
  const main = readFileSync("src/main.ts", "utf8");
  const styles = readFileSync("styles.css", "utf8");

  it("advances the plugin version so existing vaults receive an upgrade snapshot", () => {
    const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(manifest.version).toBe("0.3.0");
    expect(pkg.version).toBe(manifest.version);
  });

  it("exposes the complete task workflow", () => {
    for (const token of [
      "NewTaskModal",
      "GroupManagerModal",
      "WorkTimelineSettingTab",
      "四象限",
      "已结束",
      "异常关闭",
      "搜索任务和进展",
      "返回每日时间线",
      "切换卡牌保留草稿",
      "wt-card-composer",
      "wt-view-switch",
      "wt-ended-section",
    ]) expect(main).toContain(token);
    expect(main).not.toContain("wt-create-form");
    expect(main).toMatch(/await this\.plugin\.recordProgress\(task\.id, input\.value\);\s+this\.expandedTaskId = null;\s+this\.render\(\);/);
    expect(main).toMatch(/const id = await this\.plugin\.addTask\(values\);\s+this\.selectedTaskId = id;\s+this\.expandedTaskId = id;\s+this\.render\(\);/);
    expect(main).toContain("taskRecorded(taskId: string)");
    expect(main).toContain("this.renderViews(taskId)");
  });

  it("uses the cold precision and transparent chrome visual language", () => {
    for (const token of [
      "--wt-accent: #245be7",
      "backdrop-filter: blur",
      ".wt-card.is-expanded",
      ".wt-timeline-column",
      ".wt-view-switch",
      "prefers-reduced-motion",
    ]) expect(styles).toContain(token);
  });

  it("uses a polished and accessible modal system for task operations", () => {
    for (const token of [
      "wt-new-task-modal",
      "wt-group-manager-modal",
      "wt-field-label",
      "wt-quadrant-marker",
      "wt-primary-action",
      "创建中…",
    ]) expect(main).toContain(token);

    for (const token of [
      ".modal-container:has(.wt-modal)",
      ".wt-modal .modal-title",
      ".theme-dark .wt-modal",
      ".wt-quadrant-option input[type=\"radio\"]",
      ".wt-quadrant-marker",
      ".wt-modal .wt-primary-action",
      ".wt-modal .wt-quadrant-option:has(input:checked)",
      "@media (max-width: 600px)",
    ]) expect(styles).toContain(token);

    expect(styles).toContain("input:not([type=\"radio\"])");
    expect(styles).not.toContain(".wt-modal-form :is(input, select, textarea)");
  });

  it("offers optional card details and due-day navigation without a required feature switch", () => {
    for (const token of ["添加待办", "设置截止日期", "查看截止日", "当日截止", "wt-card-todos", "wt-card-summary", "wt-timeline-due"]) {
      expect(main + styles).toContain(token);
    }
    expect(main).toContain("this.registerInterval(");
    expect(main).toContain("check.disabled = task.status !== \"active\"");
    expect(styles).toContain(".theme-dark .wt-card-composer textarea");
  });
});
