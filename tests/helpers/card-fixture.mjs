import WorkTimelinePlugin from "../../src/main.ts";
import { createApp } from "./obsidian-browser.mjs";

const app = createApp();
const plugin = new WorkTimelinePlugin(app, { id: "work-timeline", name: "Tracelo", version: "0.3.0" });
await plugin.onload();
await plugin.addGroup("产品研发");
const common = { groupId: plugin.groups[0].id, groupName: "产品研发", important: true, urgent: false, dueDate: null, todos: [], initialProgress: "" };
const payment = await plugin.addTask({
  ...common, title: "完成支付模块", dueDate: "2026-09-30",
  initialProgress: "接口联调已通过，继续验证退款与异常流程。",
  todos: ["确认支付接口协议", "完成支付流程联调", "验证退款与异常流程", "补充上线验收记录"],
});
// Creation assigns successive millisecond timestamps to initial optional details.
await new Promise((resolve) => setTimeout(resolve, 20));
await plugin.toggleTaskTodo(payment, plugin.tasks[0].todos[0].id, true);
await plugin.toggleTaskTodo(payment, plugin.tasks[0].todos[1].id, true);
const plain = await plugin.addTask({ ...common, title: "整理客户反馈", initialProgress: "归纳了五条高频问题，正在补充具体场景。" });
const long = await plugin.addTask({ ...common, title: "检查长内容", initialProgress: "长进展要完整换行，不能被按钮高度裁切。".repeat(12), todos: ["长待办也应完整换行并保持与编辑按钮对齐。".repeat(5)] });
const dateOnly = await plugin.addTask({ ...common, title: "提交本周周报", dueDate: "2026-09-26", initialProgress: "本周完成项已整理。" });
await plugin.activateView();
window.cardFixture = { plugin, app, ids: { payment, plain, long, dateOnly } };
