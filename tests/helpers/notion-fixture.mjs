// The production renderer and archive store, with a disposable in-memory vault.
import './card-fixture.mjs';
const { plugin, ids } = window.cardFixture;
await plugin.addGroup('设计与体验');
const design = plugin.groups.find(group => group.name === '设计与体验');
await plugin.changeGroup(ids.plain, design.id);
await plugin.renameTask(ids.long, '整理任务详情与验收清单');
await plugin.recordProgress(ids.long, '已对齐验收范围，接下来核对边界场景。');
await plugin.addTask({ title: '打磨快捷记录的使用体验', groupId: design.id, groupName: design.name, important: true, urgent: false, todos: ['检查中文输入', '验证窄窗口'], initialProgress: '入口已收敛，正在检查输入与反馈。', dueDate: null });
await plugin.addTask({ title: '阅读清单与本周回顾', groupId: null, groupName: '未分组', important: false, urgent: false, todos: [], initialProgress: '整理了三篇参考文章，周五汇总结论。', dueDate: null });
