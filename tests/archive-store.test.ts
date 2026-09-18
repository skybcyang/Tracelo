import { describe, expect, it } from "vitest";

import { ArchiveStore, type ArchiveAdapter } from "../src/archive-store";
import { parseTaskMarkdown } from "../src/archive";
import { createTaskV2 } from "../src/domain";

class MemoryAdapter implements ArchiveAdapter {
  files = new Map<string, string>();
  folders = new Set<string>([""]);

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async read(path: string): Promise<string> {
    const source = this.files.get(path);
    if (source === undefined) throw new Error(`missing: ${path}`);
    return source;
  }

  async write(path: string, source: string): Promise<void> {
    this.files.set(path, source);
  }

  async mkdir(path: string): Promise<void> {
    this.folders.add(path);
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = path ? `${path}/` : "";
    const direct = (value: string) => value.startsWith(prefix) && !value.slice(prefix.length).includes("/");
    return {
      files: [...this.files.keys()].filter(direct),
      folders: [...this.folders].filter((folder) => folder !== path && direct(folder)),
    };
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async rmdir(path: string, recursive: boolean): Promise<void> {
    if (!recursive) throw new Error("tests only support recursive removal");
    const prefix = `${path}/`;
    for (const key of this.files.keys()) if (key.startsWith(prefix)) this.files.delete(key);
    for (const key of this.folders) if (key === path || key.startsWith(prefix)) this.folders.delete(key);
  }
}

const makeTask = () => createTaskV2(
  {
    title: "任务",
    groupId: null,
    groupName: "未分组",
    important: true,
    urgent: false,
  },
  new Date("2026-09-18T01:00:00.000Z"),
  "task-1",
  "event-1",
);

describe("archive store", () => {
  it("initializes support files and saves task Markdown plus a daily valid backup", async () => {
    const adapter = new MemoryAdapter();
    const store = new ArchiveStore(adapter, "工作记录/任务", ".plugin/backups", "禁止直接修改");

    await store.initialize();
    await store.saveTask(makeTask(), new Date("2026-09-18T02:00:00.000Z"));

    expect(adapter.files.get("工作记录/任务/agent.md")).toBe("禁止直接修改");
    expect(adapter.files.has("工作记录/任务/_groups.md")).toBe(true);
    expect(parseTaskMarkdown(adapter.files.get("工作记录/任务/task-1.md")!).id).toBe("task-1");
    expect(parseTaskMarkdown(adapter.files.get(".plugin/backups/daily/2026-09-18/task-1.md")!).id).toBe("task-1");
  });

  it("preserves a corrupted external copy and restores the newest valid matching backup", async () => {
    const adapter = new MemoryAdapter();
    const store = new ArchiveStore(adapter, "任务", ".plugin/backups", "规则");
    await store.initialize();
    await store.saveTask(makeTask(), new Date("2026-09-17T02:00:00.000Z"));
    adapter.files.set(".plugin/backups/daily/2026-09-18/task-1.md", "broken newest");
    adapter.files.set("任务/task-1.md", "external edit");

    const recovered = await store.recoverTask("task-1", "external edit", new Date("2026-09-18T03:00:00.000Z"));

    expect(recovered.id).toBe("task-1");
    expect(adapter.files.get("任务/task-1.md")).toContain("work-timeline-task:v1");
    expect([...adapter.files.keys()].some((path) => path.includes("external/2026-09-18") && path.endsWith("task-1.md"))).toBe(true);
  });

  it("backs up legacy state before initialization and keeps only seven daily folders", async () => {
    const adapter = new MemoryAdapter();
    const store = new ArchiveStore(adapter, "任务", ".plugin/backups", "规则");
    await store.backupLegacy({ tasks: [{ id: "old" }] }, new Date("2026-09-01T01:00:00.000Z"));
    expect([...adapter.files.keys()].some((path) => path.startsWith(".plugin/backups/migration/"))).toBe(true);

    for (let day = 1; day <= 9; day += 1) {
      await store.saveTask(makeTask(), new Date(`2026-09-${String(day).padStart(2, "0")}T02:00:00.000Z`));
    }
    const daily = await adapter.list(".plugin/backups/daily");
    expect(daily.folders.map((path) => path.split("/").at(-1))).toEqual([
      "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09",
    ]);
  });

  it("isolates an unrecoverable task while loading every valid task", async () => {
    const adapter = new MemoryAdapter();
    const store = new ArchiveStore(adapter, "任务", ".plugin/backups", "规则");
    await store.initialize();
    await store.saveTask(makeTask());
    adapter.files.set("任务/broken.md", "not a task");

    const result = await store.loadTasksSafe();

    expect(result.tasks.map(({ id }) => id)).toEqual(["task-1"]);
    expect(result.errors).toEqual([
      expect.objectContaining({ taskId: "broken", path: "任务/broken.md" }),
    ]);
  });

  it("keeps a non-pruned snapshot before a plugin upgrade", async () => {
    const adapter = new MemoryAdapter();
    const store = new ArchiveStore(adapter, "任务", ".plugin/backups", "规则");
    await store.backupUpgrade(
      [makeTask()],
      { version: 1, groups: [], events: [] },
      { initialized: true },
      "0.2.0",
      new Date("2026-09-18T03:00:00.000Z"),
    );

    const paths = [...adapter.files.keys()];
    expect(paths.some((path) => path.includes("/upgrade/") && path.endsWith("task-1.md"))).toBe(true);
    expect(paths.some((path) => path.includes("/upgrade/") && path.endsWith("_groups.md"))).toBe(true);
    expect(paths.some((path) => path.includes("/upgrade/") && path.endsWith("state.json"))).toBe(true);
  });
});
