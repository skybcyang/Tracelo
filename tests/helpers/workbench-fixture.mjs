// Uses production components with disposable in-memory tasks and material files.
import './collection-fixture.mjs';
const {plugin,app,ids}=window.cardFixture;
const query=new URLSearchParams(location.search),state=query.get('state')??'idle';
const view=app.workspace.getLeavesOfType('work-timeline-view')[0].view;
if (['directory','editing','error'].includes(state)) {
  const folder=plugin.taskFolderPath(ids.payment);
  await app.vault.adapter.mkdir(folder);await app.vault.adapter.mkdir(folder+'/参考资料');
  await app.vault.adapter.write(folder+'/参考资料/支付接口协议.md','隔离夹具：支付接口协议');
  await app.vault.adapter.write(folder+'/联调清单.md','隔离夹具：联调清单');
  app.emitVaultEvent('create',folder);
  document.querySelector('.wt-task-stage .wt-read-more').click();
  const input=document.querySelector('.wt-task-stage .wt-card-composer textarea');
  input.value='已复核退款回调，接下来补齐异常场景。';input.dispatchEvent(new Event('input',{bubbles:true}));
  if(state!=='editing')document.querySelector('.wt-task-stage .wt-read-more').click();
  if(state==='error') {const list=app.vault.adapter.list.bind(app.vault.adapter);app.vault.adapter.list=async p=>{if(p===folder)throw Error('Fixture read failure');return list(p);};app.emitVaultEvent('create',folder);}
}
if(state==='overview')document.querySelector('.wt-overview-toggle').click();
if(state==='long')document.querySelectorAll('.wt-task-cover')[0].click();

if (['mountains','architecture','abstract'].includes(query.get('background'))) await plugin.setWorkbenchBackground({...plugin.state.background,preset:query.get('background')});
