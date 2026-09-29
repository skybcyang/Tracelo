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
 await groups.getByRole('button',{name:'未分组 0',exact:true}).click();
 assert.equal(await page.locator('.wt-card').count(),0);
 await page.locator('.wt-new-task-button').click();
 assert.equal(await page.getByRole('combobox',{name:'任务分组',exact:true}).inputValue(),'');
 await page.locator('.wt-modal-title').fill('未分组任务');
 await page.getByRole('button',{name:'创建任务',exact:true}).click();
 await page.locator('.wt-new-task-modal').waitFor({state:'detached'});
 assert.equal(await groups.getByRole('button',{name:'未分组 1',exact:true}).getAttribute('aria-pressed'),'true');
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
  const geometry=await page.evaluate(()=>{
   const rect=s=>document.querySelector(s).getBoundingClientRect();
   const nav=rect('.wt-view-tools'),search=rect('.wt-search'),create=rect('.wt-new-task-button');
   return {top:search.bottom<=nav.top+1,create:create.top>=nav.top,overflow:document.querySelector('.view-content').scrollWidth>innerWidth,
    tabs:[...document.querySelectorAll('.wt-group-tab')].map(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=nav.bottom+1})};
  });
  assert.equal(geometry.top,true);assert.equal(geometry.create,true);assert.equal(geometry.overflow,false);
  assert.ok(geometry.tabs.every(Boolean),`all groups visible without horizontal scrolling at ${width}px`);
 }
 assert.deepEqual(errors,[]);
 console.log('PASS header navigation: visible groups, independent views, contextual creation, ungrouped, global search and wrapping at four widths');
} finally {await browser.close()}
