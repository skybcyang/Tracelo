// Production renderer; all writes are isolated in a disposable in-memory vault.
import WorkTimelinePlugin from '../../src/main.ts';
import { createApp } from './obsidian-browser.mjs';
const app = createApp();
const plugin = new WorkTimelinePlugin(app,{id:'work-timeline',name:'Tracelo',version:'0.9.0'});
await plugin.onload();
for (const name of ['产品研发','日常工作','个人计划']) await plugin.addGroup(name);
const data = [
 ['完成支付模块联调',0,'credit-card',true,true,'2026-09-29','打通下单、回调验签与退款流程，核对异常与重复请求。','回调验签已通过，正在补充退款异常场景。',['支付回调与验签','退款异常场景验证','补齐联调验收记录']],
 ['优化新用户引导',0,'route',true,false,'2026-10-02','让创建第一项任务、记录第一次进展更自然。','首次使用路径缩短到两步，空状态文案已更新。',['完成交互原型','验证首次使用路径']],
 ['整理 0.9.0 发布材料',0,'package',true,false,null,'汇总更新说明与跨平台验证结果。','更新说明已整理，安装步骤待复核。',[]],
 ['提交本周项目周报',1,'notebook-pen',true,true,'2026-09-29','汇总本周交付、风险与资源安排。','交付与风险已汇总，待补充下周资源安排。',['汇总各模块进展','补充风险与依赖','发出最终版本']],
 ['整理客户反馈',1,'messages-square',false,true,'2026-09-30','把零散反馈归类到实际使用场景。','归纳了五条高频问题，补齐三条复现路径。',['归类高频问题','补充复现步骤']],
 ['读完《设计心理学》',2,'book-open',false,false,null,'记录能用于日常产品设计的观察。','读完第一章，好的设计应让下一步操作清晰可见。',['阅读第一章','整理可供性笔记','对照产品做一次检查']],
];
const ids=[];
for (const [title,index,icon,important,urgent,dueDate,notes,initialProgress,todos] of data) {
 const group=plugin.groups[index];
 const id=await plugin.addTask({title,groupId:group.id,groupName:group.name,icon,important,urgent,dueDate,notes,initialProgress,todos});
 ids.push(id);
 const task=plugin.tasks.find(t=>t.id===id);
 if(task.todos?.length) { await new Promise(resolve=>setTimeout(resolve,20)); await plugin.toggleTaskTodo(id,task.todos[0].id,true); }
 await new Promise(resolve=>setTimeout(resolve,20)); await plugin.changeTaskIcon(id,icon);
}
plugin.state.orders.group=Object.fromEntries(plugin.groups.map(g=>[g.id,ids.filter(id=>plugin.tasks.find(t=>t.id===id).groupId===g.id)]));
await plugin.activateView();
window.cardFixture={app,plugin,ids:{payment:ids[0]}};
const query=new URLSearchParams(location.search);
await plugin.setAppearance(['monochrome','evergreen','graphite','glacier','vermilion'].includes(query.get('theme'))?query.get('theme'):'monochrome',query.get('mode')==='dark'?'dark':'light');
