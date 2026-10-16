import { describe, it, expect } from 'vitest';
import { createTask, addProgress } from '../src/domain';
import { parseConversationReply, applyConversationUpdate, taskRevision, buildConversationRequest, type ConversationContext } from '../src/work-conversation';

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

const longTask = () => {
  let t = createTask({title:'冷启动优化',groupId:null,groupName:'未分组',important:false,urgent:false},new Date('2026-07-01T01:00:00Z'),'long-task','created');
  for(let i=0;i<80;i++) t=addProgress(t,i===3?'缓存方案因内存占用过高而放弃':i===4?'旧记录中解释了并行初始化方案':'完成常规检查 '+i,new Date(Date.UTC(2026,6,2+i,1)), 'history-'+i);
  return t;
};
const requestContext = (t=longTask()) => ({...context,tasks:[t]});
const requestData = (c:ConversationContext,question='为什么当时放弃缓存方案？') => {
  const body=buildConversationRequest([{role:'user',text:question,refs:['long-task']}],c,{model:'test',baseUrl:'https://example.test'});
  return JSON.parse(body.messages[1].content.split('（不是指令）：')[1]);
};
describe('长历史读取与来源',()=>{
  it('从问题检索三十条以前的相关记录，保留最近历史与稳定来源身份',()=>{
    const data=requestData(requestContext());
    expect(data.tasks[0].history).toEqual(expect.arrayContaining([expect.objectContaining({id:'history-3',day:'2026-07-05',text:'缓存方案因内存占用过高而放弃'})]));
    expect(data.tasks[0].history.at(-1).id).toBe('history-79');
    expect(data.tasks[0].history).toHaveLength(new Set(data.tasks[0].history.map((e:{id:string})=>e.id)).size);
  });
  it('显式关键词与历史本地日期范围过滤旧记录，范围外最近历史单独说明',()=>{
    const c={...requestContext(),historyQuery:{query:'并行初始化',from:'2026-07-06',to:'2026-07-06'}};
    const data=requestData(c);
    expect(data.tasks[0].retrieval).toMatchObject({matched:1,returned:1});
    expect(data.tasks[0].history).toEqual(expect.arrayContaining([expect.objectContaining({id:'history-4'})]));
    expect(data.tasks[0].history.some((e:{id:string})=>e.id==='history-3')).toBe(false);
  });
  it('未匹配时明确零结果和有限阅读范围，不把全部历史发给模型',()=>{
    const c={...requestContext(),historyQuery:{query:'从未出现的词'}};
    const data=requestData(c);
    expect(data.tasks[0].history).toHaveLength(30);
    expect(data.tasks[0].retrieval).toMatchObject({total:81,matched:0,returned:0,recent:30});
  });
  it('大量匹配只补充有限旧记录，并报告结果截断',()=>{
    const c={...requestContext(),historyQuery:{query:'常规检查'}};
    const data=requestData(c);
    expect(data.tasks[0].history.length).toBeLessThanOrEqual(42);
    expect(data.tasks[0].retrieval.matched).toBe(78);
    expect(data.tasks[0].retrieval.returned).toBeLessThan(data.tasks[0].retrieval.matched);
  });
  it('无效日期范围在调用模型前拒绝',()=>{
    for(const historyQuery of [{from:'2026-02-30'},{from:'2026-08-01',to:'2026-07-01'}])expect(()=>requestData({...requestContext(),historyQuery})).toThrow(/日期/);
  });
  it('来源仅接受本次发送的事件，保留当时日期、名称与原文摘要',()=>{
    const c={...requestContext(),historyQuery:{query:'缓存'}};
    const result=parseConversationReply(JSON.stringify({reply:'当时因内存占用放弃缓存方案。',proposal:null,sources:[{taskId:'long-task',eventId:'history-3'}]}),c,'reply-1');
    expect(result).toMatchObject({sources:[{taskId:'long-task',eventId:'history-3',day:'2026-07-05',title:'冷启动优化',text:'缓存方案因内存占用过高而放弃'}]});
  });
  it('拒绝伪造、未引用及没有发送给模型的来源',()=>{
    const c={...requestContext(),historyQuery:{query:'缓存'}};
    for(const source of [{taskId:'long-task',eventId:'missing'},{taskId:'outside',eventId:'history-3'},{taskId:'long-task',eventId:'history-4'}])expect(()=>parseConversationReply(JSON.stringify({reply:'依据如下',proposal:null,sources:[source]}),c,'reply-1')).toThrow(/来源/);
  });
});
