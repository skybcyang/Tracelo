import { describe, expect, it } from "vitest";

import {
  addProgress,
  changeTaskGroup,
  changeTaskQuadrant,
  closeTask,
  completeTask,
  createTaskV2,
  eventsByDay,
  pinTask,
  renameTask,
  reopenTask,
  searchTasks,
  type TaskOrders,
} from "../src/domain";

const at = (hour: number) => new Date(`2026-09-18T0${hour}:00:00.000Z`);

describe("final task rules", () => {
  it("requires an explicit quadrant and snapshots local event identity", () => {
    expect(() =>
      createTaskV2(
        { title: "排查登录异常", groupId: null, groupName: "未分组" },
        at(1),
        "task-1",
        "event-1",
      ),
    ).toThrow("必须选择象限");

    const task = createTaskV2(
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
    const created = createTaskV2(
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
    const created = createTaskV2(
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
    const active = createTaskV2(
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
      createTaskV2(
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
      createTaskV2(
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
    const task = createTaskV2(
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
