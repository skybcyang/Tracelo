import { describe, expect, it } from "vitest";

import {
  addProgress,
  addTodo,
  changeTaskGroup,
  changeTaskQuadrant,
  closeTask,
  completeTask,
  createTask,
  dueTasksForDay,
  editTodo,
  eventsByDay,
  pinTask,
  renameTask,
  reopenTask,
  removeTodo,
  restoreTodo,
  searchTasks,
  setDueDate,
  toggleTodo,
  type TaskOrders,
} from "../src/domain";

const at = (hour: number) => new Date(`2026-09-18T0${hour}:00:00.000Z`);

describe("final task rules", () => {
  it("requires an explicit quadrant and snapshots local event identity", () => {
    expect(() =>
      createTask(
        { title: "排查登录异常", groupId: null, groupName: "未分组" },
        at(1),
        "task-1",
        "event-1",
      ),
    ).toThrow("必须选择象限");

    const task = createTask(
      {
        title: " 排查登录异常 ",
        groupId: "support",
        groupName: "客户支持",
        important: true,
        urgent: true,
      },
      at(1),
      "task-1",
      "event-1",
    );

    expect(task).toMatchObject({
      id: "task-1",
      title: "排查登录异常",
      status: "active",
      groupId: "support",
      groupName: "客户支持",
      important: true,
      urgent: true,
    });
    expect(task.events[0]).toMatchObject({
      kind: "created",
      title: "排查登录异常",
      groupName: "客户支持",
      important: true,
      urgent: true,
    });
    expect(task.events[0]?.timezone).toBeTruthy();
  });

  it("keeps old names in history while current task uses the new name", () => {
    const created = createTask(
      {
        title: "旧名称",
        groupId: null,
        groupName: "未分组",
        important: true,
        urgent: false,
      },
      at(1),
      "task-1",
      "event-1",
    );
    const renamed = renameTask(created, "新名称", at(2), "event-2");

    expect(renamed.title).toBe("新名称");
    expect(renamed.events[0]?.title).toBe("旧名称");
    expect(renamed.events[1]).toMatchObject({
      kind: "renamed",
      title: "新名称",
      meta: { from: "旧名称", to: "新名称" },
    });
  });

  it("records group and quadrant changes but does not rewrite prior events", () => {
    const created = createTask(
      {
        title: "任务",
        groupId: "one",
        groupName: "分组一",
        important: false,
        urgent: false,
      },
      at(1),
      "task-1",
      "event-1",
    );
    const regrouped = changeTaskGroup(
      created,
      "two",
      "分组二",
      at(2),
      "event-2",
      "拖动调整",
    );
    const reprioritized = changeTaskQuadrant(
      regrouped,
      true,
      true,
      at(3),
      "event-3",
    );

    expect(reprioritized).toMatchObject({ groupId: "two", groupName: "分组二", important: true, urgent: true });
    expect(reprioritized.events.map(({ kind }) => kind)).toEqual([
      "created",
      "group_changed",
      "quadrant_changed",
    ]);
    expect(reprioritized.events[0]?.groupName).toBe("分组一");
    expect(reprioritized.events[1]?.meta).toMatchObject({
      from: "分组一",
      to: "分组二",
      reason: "拖动调整",
    });
  });

  it("supports completion and exceptional closure, preserves history, and requires reopening before progress", () => {
    const active = createTask(
      {
        title: "任务",
        groupId: null,
        groupName: "未分组",
        important: false,
        urgent: true,
      },
      at(1),
      "task-1",
      "event-1",
    );
    const completed = completeTask(active, at(2), "event-2");
    expect(completed.status).toBe("completed");
    expect(() => addProgress(completed, "补充", at(3), "event-3")).toThrow("必须先重新打开");
    const reopened = reopenTask(completed, at(3), "event-3");
    expect(addProgress(reopened, "补充", at(4), "event-4").events).toHaveLength(4);

    expect(() => closeTask(active, " ", at(2), "close-1")).toThrow("必须填写异常关闭原因");
    const closed = closeTask(active, "需求取消", at(2), "close-2");
    expect(closed).toMatchObject({ status: "closed" });
    expect(closed.events.at(-1)).toMatchObject({ kind: "closed", text: "需求取消" });
    expect(reopenTask(closed, at(3), "event-3")).toMatchObject({ status: "active" });
  });

  it("reads history from oldest to newest and searches all statuses by names and progress", () => {
    const first = addProgress(
      createTask(
        {
          title: "登录故障",
          groupId: null,
          groupName: "未分组",
          important: true,
          urgent: true,
        },
        at(1),
        "task-1",
        "event-1",
      ),
      "确认缓存键冲突",
      at(3),
      "event-3",
    );
    const second = completeTask(
      createTask(
        {
          title: "月报",
          groupId: null,
          groupName: "未分组",
          important: true,
          urgent: false,
        },
        at(2),
        "task-2",
        "event-2",
      ),
      at(4),
      "event-4",
    );

    expect(eventsByDay(first.events)[0]?.events.map(({ id }) => id)).toEqual(["event-1", "event-3"]);
    expect(searchTasks([first, second], "缓存").map(({ id }) => id)).toEqual(["task-1"]);
    expect(searchTasks([first, second], "月报").map(({ id }) => id)).toEqual(["task-2"]);
  });

  it("pins only the updated task while retaining every other manual order", () => {
    const orders: TaskOrders = {
      group: { support: ["a", "b", "c"] },
      quadrant: { important_urgent: ["c", "b", "a"] },
    };
    const task = createTask(
      {
        title: "B",
        groupId: "support",
        groupName: "客户支持",
        important: true,
        urgent: true,
      },
      at(1),
      "b",
      "event-b",
    );

    expect(pinTask(orders, task)).toEqual({
      group: { support: ["b", "a", "c"] },
      quadrant: { important_urgent: ["b", "c", "a"] },
    });
  });
});

describe("optional task details", () => {
  const base = () => createTask({ title: "交付", groupId: null, groupName: "未分组", important: true, urgent: false }, at(1), "task-1", "created");

  it("defaults to neither option and projects only current due dates onto a day", () => {
    const plain = base();
    expect(plain.dueDate).toBeUndefined();
    expect(plain.todos).toBeUndefined();
    const scheduled = setDueDate(plain, "2026-09-30", at(2), "due-1");
    expect(dueTasksForDay([scheduled, plain], "2026-09-30")).toEqual([scheduled]);
    expect(scheduled.events.at(-1)).toMatchObject({ kind: "due_changed", meta: { from: null, to: "2026-09-30" } });
    const cleared = setDueDate(scheduled, null, at(3), "due-2");
    expect(dueTasksForDay([cleared], "2026-09-30")).toEqual([]);
    expect(cleared.events.at(-1)).toMatchObject({ kind: "due_changed", meta: { from: "2026-09-30", to: null } });
    expect(() => setDueDate(plain, "2026-02-30", at(2), "bad")).toThrow("截止日期无效");
  });

  it("adds, edits, checks and restores todos without changing their order or the main task status", () => {
    const one = addTodo(base(), " 首项 ", at(2), "todo-1", "event-1");
    const two = addTodo(one, "次项", at(3), "todo-2", "event-2");
    const checked = toggleTodo(two, "todo-1", true, at(4), "event-3");
    expect(checked.todos).toEqual([{ id: "todo-1", text: "首项", done: true }, { id: "todo-2", text: "次项", done: false }]);
    expect(checked.status).toBe("active");
    expect(checked.events.at(-1)).toMatchObject({ kind: "todo_done", text: "首项" });
    const edited = editTodo(checked, "todo-2", "新次项", at(5), "event-4");
    expect(edited.todos?.[1]?.text).toBe("新次项");
    const removed = removeTodo(edited, "todo-1", at(6), "event-5");
    expect(removed.todos).toEqual([{ id: "todo-2", text: "新次项", done: false }]);
    const restored = restoreTodo(removed, { id: "todo-1", text: "首项", done: true }, 0, at(7), "event-6");
    expect(restored.todos).toEqual(edited.todos);
    expect(restored.events.map(({ kind }) => kind).slice(-6)).toEqual(["todo_added", "todo_added", "todo_done", "todo_edited", "todo_removed", "todo_restored"]);
    expect(() => toggleTodo(completeTask(restored, at(8), "ended"), "todo-1", false, at(9), "event-7")).toThrow("必须先重新打开");
  });
});
