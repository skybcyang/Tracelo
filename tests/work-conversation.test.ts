import { describe, it, expect } from 'vitest';
import { createTask, addProgress } from '../src/domain';
import { parseConversationReply, applyConversationUpdate, taskRevision, buildConversationRequest } from '../src/work-conversation';

const task = createTask({title:'相机排查',groupId:null,groupName:'未分组',important:false,urgent:false}, new Date('2026-10-06T01:00:00Z'),'task-1','event-1');
const context = {tasks:[task],groups:[],today:'2026-10-06',timezone:'Asia/Shanghai'};
const update = {type:'update',taskId:task.id,actions:[{kind:'progress',text:'已采集日志'},{kind:'due',text:'2026-10-09'}]};
const parse = (proposal:unknown) => parseConversationReply(JSON.stringify({reply:'请确认修改',proposal}),context,'operation-1');
describe('工作对话确认协议',()=>{
  it('讨论不产生任务操作',()=>expect(parse(null).proposal).toBeNull());
  it('仅允许引用范围内的任务',()=>expect(()=>parse({...update,taskId:'unreferenced'})).toThrow());
  it('拒绝删除、任意文件和完成操作',()=>{for(const kind of ['delete','shell','complete'])expect(()=>parse({...update,actions:[{kind,text:'x'}]})).toThrow();});
  it('拒绝不存在的待办、分组与无效日期',()=>{for(const action of [{kind:'todo_toggle',todoId:'missing',done:true},{kind:'group',text:'missing'},{kind:'due',text:'2026-02-30'}])expect(()=>parse({...update,actions:[action]})).toThrow();});
  it('单任务多字段一次产生可审计的变更，重试不重复',()=>{
    const p=parse(update).proposal!;
    if(p.type!=='update')throw Error();
    expect(p.revision).toBe(taskRevision(task));
    const next=applyConversationUpdate(task,p,[]);
    expect(task.events).toHaveLength(1);
    expect(next.dueDate).toBe('2026-10-09');
    expect(next.events.filter(e=>e.kind==='progress')).toHaveLength(1);
    expect(applyConversationUpdate(next,p,[])).toBe(next);
  });
  it('外部编辑后拒绝过期提议',()=>{
    const p=parse(update).proposal!;if(p.type!=='update')throw Error();
    expect(()=>applyConversationUpdate(addProgress(task,'其他编辑',new Date(),'external-event'),p,[])).toThrow(/变化/);
  });
  it('创建使用稳定身份与明确默认值',()=>{
    const p=parse({type:'create',values:{title:'分析日志',notes:'',groupId:null,important:null,urgent:null,dueDate:null,todos:['分析'],initialProgress:'',warnings:[]}}).proposal!;
    expect(p.type).toBe('create');if(p.type!=='create')return;
    expect(p.values.creationId).toBe('operation-1');expect(p.values.important).toBe(false);
  });
  it('请求带多轮消息与引用的有限上下文，不发送路径或凭证',()=>{
    const body=buildConversationRequest([{role:'user',text:'先整理想法',refs:[]},{role:'assistant',text:'先分析耗时',refs:[]},{role:'user',text:'把它记录下来',refs:[task.id]}],context,{model:'test',baseUrl:'https://example.com',apiKey:'SECRET'});
    expect(body.messages).toHaveLength(5);
    expect(JSON.stringify(body)).not.toContain('SECRET');
    expect(JSON.stringify(body)).toContain('先整理想法');
  });
});
