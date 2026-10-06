import { describe, expect, it } from "vitest";
import { createTask, addProgress, latestProgressAt, searchTasks, setTaskNotes, setTaskIcon, taskIcon } from "../src/domain";
import { createDefaultState, normalizePluginState, parseTaskMarkdown, serializeTaskMarkdown, serializeLegacyTaskMarkdown, serializeGroupArchive, parseGroupArchive } from "../src/archive";

const at = (hour: number) => new Date(`2026-09-27T0${hour}:00:00.000Z`);
const base = () => createTask({ title: "任务", groupId: null, groupName: "未分组", important: false, urgent: false }, at(1), "task-1", "created");

describe("task context independent of progress", () => {
  it("preserves mixed Markdown notes exactly and records a separate property event", () => {
    const task = addProgress(base(), "进展", at(2), "progress");
    const notes = "背景\n\n![截图](image.png)\n\n下一段  \n";
    const changed = setTaskNotes(task, notes, at(3), "notes");
    expect(changed.notes).toBe(notes);
    expect(changed.events.slice(0, 2)).toEqual(task.events);
    expect(changed.events.at(-1)).toMatchObject({ kind: "notes_changed", meta: { from: "", to: notes } });
    expect(latestProgressAt(changed)).toBe(at(2).toISOString());
    expect(setTaskNotes(changed, notes, at(4), "noop")).toBe(changed);
    const cleared = setTaskNotes(changed, "", at(4), "clear");
    expect(cleared.notes).toBeUndefined();
    expect(searchTasks([cleared], "背景")).toEqual([]);
    expect(searchTasks([changed], "背景")).toEqual([changed]);
  });

  it("adds initial notes without synthesizing progress or a property mutation", () => {
    const task = createTask({ title: "标题", groupId: null, groupName: "未分组", important: false, urgent: false, notes: "第二行\n第三行" }, at(1), "new", "created");
    expect(task.notes).toBe("第二行\n第三行");
    expect(task.events.map(event => event.kind)).toEqual(["created"]);
  });

  it("resolves a stable group icon with per-card override and hidden state", () => {
    const task = { ...base(), groupId: "group" };
    const groups = [{ id: "group", name: "组", icon: "folder" }];
    expect(taskIcon(task, groups)).toBe("folder");
    expect(taskIcon(base(), [])).toBe("circle-dot");
    const changed = setTaskIcon(task, "code", at(2), "icon");
    expect(taskIcon(changed, groups)).toBe("code");
    expect(changed.events.at(-1)?.kind).toBe("icon_changed");
    expect(taskIcon(setTaskIcon(changed, null, at(3), "hide"), groups)).toBeNull();
    expect(taskIcon(setTaskIcon(changed, undefined, at(3), "reset"), groups)).toBe("folder");
    expect(() => setTaskIcon(task, "<svg>", at(2), "bad")).toThrow();
  });
});

describe("extended v1 archive", () => {
  it.each(['noto:rocket', 'noto:1st-place-medal', 'noto:books'])("round trips Noto task and group icons: %s", icon => {
    const task = setTaskIcon(base(), icon, at(2), 'color-icon');
    expect(parseTaskMarkdown(serializeTaskMarkdown(task))).toEqual(task);
    const groups = { version: 1 as const, groups: [{ id: 'g', name: '彩色', icon }], events: [] };
    expect(parseGroupArchive(serializeGroupArchive(groups))).toEqual(groups);
  });
  it('rejects unsupported namespaces and malformed Noto names', () => {
    for (const icon of ['other:rocket', 'noto:../rocket', 'noto:', 'noto:rocket:blue']) {
      expect(() => setTaskIcon(base(), icon, at(2), 'bad')).toThrow();
    }
  });
  it("round trips notes and icons, checks their readable projection, and accepts old tasks", () => {
    const old = base();
    expect(serializeLegacyTaskMarkdown(old)).not.toContain("## 详情");
    expect(parseTaskMarkdown(serializeTaskMarkdown(old))).toEqual(old);
    const task = setTaskIcon(setTaskNotes(old, "前文\n![图](capture.png)\n后文", at(2), "notes"), null, at(3), "icon");
    const source = serializeLegacyTaskMarkdown(task);
    expect(source).toContain("## 详情\n\n前文\n![图](capture.png)\n后文\n\n## 时间线");
    expect(parseTaskMarkdown(source)).toEqual(task);
    expect(() => parseTaskMarkdown(source.replace("## 详情\n\n前文", "## 详情\n\n改写"))).toThrow();
    const legacy = source.replace('## 详情', '## 备注').replaceAll('**详情变更**', '**备注变更**');
    expect(parseTaskMarkdown(legacy)).toEqual(task);
    expect(() => parseTaskMarkdown(legacy.replace('## 备注\n\n前文', '## 备注\n\n改写'))).toThrow();
    for (const invalid of [{ notes: 42 }, { icon: "" }, { icon: "../bad" }, { materialFolder: "任务/../other" }]) {
      expect(() => serializeTaskMarkdown({ ...old, ...invalid } as never)).toThrow();
    }
    expect(parseTaskMarkdown(serializeTaskMarkdown({ ...old, materialFolder: "自定义/任务/任务一" })).materialFolder).toBe("自定义/任务/任务一");
  });

  it("preserves group icon defaults through archive round trips", () => {
    const groups = { version: 1 as const, groups: [{ id: "g", name: "开发", icon: "code" }], events: [] };
    expect(parseGroupArchive(serializeGroupArchive(groups))).toEqual(groups);
    expect(() => serializeGroupArchive({ ...groups, groups: [{ id: "g", name: "开发", icon: "<bad>" }] })).toThrow();
  });

  it("normalizes independent board preferences and preserves notes drafts", () => {
    expect(createDefaultState()).toMatchObject({ boardZoom: 100, noteDrafts: {} });
    expect(createDefaultState().presentationMode).toBe(false);
    const legacy = normalizePluginState({ boardZoom: 81, presentationMode: true, noteDrafts: { one: "草稿", two: 2 } });
    expect(legacy).toMatchObject({ boardZoom: 80, noteDrafts: { one: "草稿" } });
    expect(legacy.presentationMode).toBe(true);
    expect(normalizePluginState({ boardZoom: 500 }).boardZoom).toBe(120);
    expect(normalizePluginState({ boardZoom: 20 }).boardZoom).toBe(60);
    expect(normalizePluginState({ boardZoom: NaN }).boardZoom).toBe(100);
  });
});
