import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const bundle=await build({entryPoints:['tests/helpers/collection-fixture.mjs'],bundle:true,write:false,format:'esm',external:['electron','node:child_process'],alias:{obsidian:resolve('tests/helpers/obsidian-browser.mjs')}});
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://tracelo.test/',r=>r.fulfill({contentType:'text/html',body:'<style>'+readFileSync('tests/helpers/obsidian-host.css','utf8')+readFileSync('styles.css','utf8')+'</style><script type="module">'+bundle.outputFiles[0].text+'</script>'}));
 await page.goto('https://tracelo.test/');await page.waitForFunction(()=>window.cardFixture);
 const groups=page.getByRole('navigation',{name:'按分组筛选任务'});
 assert.equal(await groups.count(),1,'group names must be exposed as navigation, not a dropdown');
 assert.equal(await page.locator('.wt-header select.wt-board-filters').count(),0);
 assert.equal(await page.locator('.wt-header-actions [aria-label="快捷记录"]').count(),0,'redundant quick-record icon is removed');
 async function selectGroup(name) {
  const direct=groups.getByRole('button',{name,exact:true});
  if(!await direct.isVisible()) await groups.locator('.wt-group-overflow summary').click();
  await groups.getByRole('button',{name,exact:true}).click();
 }
 await groups.getByRole('button',{name:'产品研发 3',exact:true}).click();
 assert.equal(await page.locator('.wt-card').count(),3);
 await page.getByRole('button',{name:'四象限',exact:true}).click();
 assert.equal(await groups.getByRole('button',{name:'产品研发 3',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('.wt-card').count(),3,'view changes preserve group filtering');
 await page.locator('.wt-new-task-button').click();
 assert.equal(await page.getByRole('combobox',{name:'任务分组',exact:true}).inputValue(),await page.evaluate(()=>window.cardFixture.plugin.groups[0].id));
 await page.locator('.wt-modal-title').fill('当前分组新任务');
 await page.getByRole('button',{name:'创建任务',exact:true}).click();
 await page.locator('.wt-new-task-modal').waitFor({state:'detached'});
 assert.equal(await groups.getByRole('button',{name:'产品研发 4',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('.wt-card').count(),4);
 await selectGroup('未分组 0');
 assert.equal(await page.locator('.wt-card').count(),0);
 await page.locator('.wt-new-task-button').click();
 assert.equal(await page.getByRole('combobox',{name:'任务分组',exact:true}).inputValue(),'');
 await page.locator('.wt-modal-title').fill('未分组任务');
 await page.getByRole('button',{name:'创建任务',exact:true}).click();
 await page.locator('.wt-new-task-modal').waitFor({state:'detached'});
 assert.equal(await groups.locator('[data-group-id="ungrouped"]').getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'分组看板',exact:true}).click();
 assert.equal(await page.locator('.wt-card').count(),1);
 // Search remains global, even while a group is selected.
 await page.getByRole('searchbox').fill('支付模块');
 assert.ok(await page.locator('.wt-search-result').count()>0);
 await page.getByRole('button',{name:'清除搜索',exact:true}).click();
 await groups.getByRole('button',{name:'全部 8',exact:true}).click();
 await page.evaluate(async()=>{for(const name of ['客户支持','品牌与内容','基础设施','研究与探索','年度规划'])await window.cardFixture.plugin.addGroup(name)});
 for(const width of [1440,960,560,390]){
  await page.setViewportSize({width,height:900});
  await page.waitForTimeout(80);
  const geometry=await page.evaluate(()=>{
   const rect=s=>document.querySelector(s).getBoundingClientRect();
   const nav=rect('.wt-view-tools'),search=rect('.wt-search'),create=rect('.wt-new-task-button');
   return {top:search.bottom<=nav.top+1,create:create.top>=nav.top,overflow:document.querySelector('.view-content').scrollWidth>innerWidth,
    tabs:[...document.querySelectorAll('.wt-group-navigation > .wt-group-tab:not([hidden])')].map(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=nav.bottom+1}),
    groupHeight:rect('.wt-group-navigation').height};
  });
  assert.equal(geometry.top,true);assert.equal(geometry.create,true);assert.equal(geometry.overflow,false);
  assert.ok(geometry.tabs.every(Boolean),`leading groups fit at ${width}px`);
  assert.ok(geometry.groupHeight<=45,`group navigation stays on one line at ${width}px`);
  const more=groups.locator('.wt-group-overflow');
  assert.equal(await more.isVisible(),true);
  await more.locator('summary').click();
  assert.equal(await more.getByRole('button',{name:'年度规划 0',exact:true}).isVisible(),true);
  assert.equal(await more.locator('.wt-group-overflow-panel').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth}),true,'dropdown stays inside viewport');
  await page.keyboard.press('Escape');
  assert.equal(await more.getAttribute('open'),null);
 }
 await selectGroup('年度规划 0');
 assert.equal(await groups.locator('.wt-group-overflow summary').innerText(),'年度规划');
 assert.equal(await page.locator('.wt-card').count(),0);
 await groups.getByRole('button',{name:'全部 8',exact:true}).click();
 await page.setViewportSize({width:2400,height:900});
 await page.waitForTimeout(80);
 assert.equal(await groups.locator('.wt-group-overflow').isVisible(),false,'overflow disappears when all groups fit');
 await page.evaluate(async()=>{for(const group of window.cardFixture.plugin.groups)await window.cardFixture.plugin.renameGroup(group.id,group.name+' · 跨团队项目跟进与长期规划')});
 await page.setViewportSize({width:375,height:900});
 await page.waitForTimeout(80);
 await groups.locator('.wt-group-overflow summary').focus();
 await page.keyboard.press('ArrowDown');
 assert.equal(await groups.locator('.wt-group-overflow-panel').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth}),true,'long-name dropdown stays inside viewport');
 assert.equal(await groups.locator('.wt-group-overflow-panel').evaluate(el=>el.contains(document.activeElement)),true,'arrow keys enter the dropdown');
 await page.keyboard.press('Escape');
 assert.equal(await groups.locator('.wt-group-overflow summary').evaluate(el=>el===document.activeElement),true);
 await page.keyboard.press('ArrowUp');
 assert.equal(await groups.locator('.wt-group-overflow-panel button').last().evaluate(el=>el===document.activeElement),true,'ArrowUp enters at the last group');
 await page.keyboard.press('Escape');
 await selectGroup('年度规划 · 跨团队项目跟进与长期规划 0');
 await groups.locator('.wt-group-overflow summary').click();
 assert.equal(await groups.locator('.wt-group-overflow-panel').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth}),true,'selected long group does not push the dropdown offscreen');
 await groups.getByRole('button',{name:'全部 8',exact:true}).click();
 await page.setViewportSize({width:1440,height:900});
 for(const theme of ['evergreen','graphite','glacier','vermilion']) for(const mode of ['light','dark']) {
  await page.evaluate(([theme,mode])=>window.cardFixture.plugin.setAppearance(theme,mode),[theme,mode]);
  await page.locator('.wt-card').first().locator('.wt-card-open').click({button:'right'});
  const menu=page.locator('.wt-themed-menu').first();
  assert.equal(await menu.isVisible(),true);
  assert.equal(await menu.evaluate(el=>getComputedStyle(el).backgroundColor),await page.locator('.work-timeline-view').evaluate(el=>getComputedStyle(el).getPropertyValue('--wt-card').trim()).then(hex=>{
   const parts=hex.slice(1).match(/.{2}/g).map(v=>parseInt(v,16));return `rgb(${parts.join(', ')})`;
  }));
  await page.getByRole('menuitem',{name:'分组',exact:true}).click();
  assert.equal(await page.getByRole('menuitem',{name:'未分组',exact:true}).evaluate(el=>!!el.closest('.wt-themed-menu')),true);
  await page.getByRole('menuitem',{name:'未分组',exact:true}).click();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS header navigation: ordered overflow, hidden-group selection, keyboard dismissal, contextual creation and themed menus at four widths / eight appearances');
} finally {await browser.close()}
