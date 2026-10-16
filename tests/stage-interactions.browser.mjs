import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const bundle=await build({entryPoints:['tests/helpers/card-fixture.mjs'],bundle:true,write:false,format:'esm',external:['electron','node:child_process'],alias:{obsidian:resolve('tests/helpers/obsidian-browser.mjs')}});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1728,height:1080},reducedMotion:'reduce'});
page.setDefaultTimeout(7000);
const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://tracelo.test/**',r=>r.fulfill({contentType:'text/html',body:`<meta charset="utf-8"><style>${readFileSync('tests/helpers/obsidian-host.css','utf8')}\n${readFileSync('styles.css','utf8')}</style><script type="module">${bundle.outputFiles[0].text}</script>`}));
const snapshot=()=>page.evaluate(()=>[...document.querySelectorAll('.wt-stage-column')].map(c=>[...c.querySelectorAll('[data-stage-module]')].map(r=>r.dataset.stageModule)));
const check=(name,value)=>{assert.ok(value,name);checks.push(name);};
const reset=async()=>{await page.getByRole('button',{name:'恢复默认布局',exact:true}).click();await page.locator('.wt-layout-status').filter({hasText:'布局已保存'}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('.wt-stage-column').length===2&&document.querySelector('.wt-stage-column:nth-child(3) [data-stage-module="details"]'));};
const dragInto=async(source,target,x,y)=>{const box=await target.boundingBox();await source.dragTo(target,{targetPosition:{x:box.width*x,y:box.height*y}});};
try {
 await page.goto('https://tracelo.test/?workbench=1');await page.waitForFunction(()=>window.cardFixture);
 const ids=await page.evaluate(()=>window.cardFixture.ids);await page.locator(`[data-cover-task="${ids.payment}"]`).click();
 const details=page.locator('[data-stage-module="details"]'),todos=page.locator('[data-stage-module="todos"]');
 check('内容卡片标题可直接拖动，不必回左侧重新找模块',await details.locator('h2').getAttribute('draggable')==='true');
 await page.locator('.wt-task-stage .wt-read-more').click();
 const input=page.getByRole('textbox',{name:'记录当前进展',exact:true});await input.fill('操作对齐时保留的未提交进展');const editor=await input.elementHandle();
 const defaultRows=await page.locator('.wt-stage-column').nth(1).locator(':scope > [data-stage-module]').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height));check('默认列内实际行高均分',Math.abs(defaultRows[0]-defaultRows[1])<1);
 const original=await page.evaluate(()=>JSON.stringify(window.cardFixture.plugin.tasks));
 await todos.hover();check('普通悬停即可收回模块，无须先打开调整布局',await page.getByRole('button',{name:'删除待办视图',exact:true}).isVisible());
 // Move upwards within the same column: the insertion index refers to the original target row.
 await dragInto(details.locator('h2'),todos,.5,.18);
 await page.waitForFunction(()=>document.querySelector('.wt-stage-column:nth-child(3) [data-stage-module]')?.dataset.stageModule==='details');
 check('从卡片标题拖到卡片上半部，插入该行前',JSON.stringify(await snapshot())===JSON.stringify([['progress'],['details','todos']]));
 // Moving a module to its existing upper/lower boundary must not swap unrelated rows.
 await dragInto(page.locator('[data-stage-module="details"] h2'),page.locator('[data-stage-module="details"]'),.5,.85);
 check('拖回自身下边界保持原位置',JSON.stringify(await snapshot())===JSON.stringify([['progress'],['details','todos']]));
 await reset();
 // The rendered boundary, not just saved preferences, must respond to row resizing.
 const rowHandle=page.getByRole('separator',{name:'调整卡片高度',exact:true});
 const rowBefore=await page.locator('[data-stage-module="todos"]').boundingBox();
 await rowHandle.focus();await page.keyboard.press('ArrowDown');
 await page.waitForFunction(()=>Object.values(window.cardFixture.plugin.state.stageLayouts)[0].columns[1].rows[0].height>.5);
 const rowAfter=await page.locator('[data-stage-module="todos"]').boundingBox();
 check('调整行高会改变实际卡片高度',rowAfter.height>rowBefore.height+2);
 await reset();
 // Drop onto a card edge, not the tiny + button.
 await dragInto(page.locator('[data-module="files"]'),page.locator('[data-stage-module="details"]'),.97,.1);
 await page.waitForFunction(()=>document.querySelectorAll('.wt-stage-column').length===3);
 check('缩略图拖到卡片右边缘可新增一列',JSON.stringify(await snapshot())===JSON.stringify([['progress'],['todos','details'],['files']]));
 const widths=await page.locator('.wt-stage-column').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().width));check('新增列默认均分',Math.max(...widths)-Math.min(...widths)<2);
 await page.getByRole('button',{name:'删除目录视图',exact:true}).focus();await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelectorAll('.wt-stage-column').length===2);
 check('收回目录后草稿编辑节点仍存在',await editor.evaluate(e=>e.isConnected));check('草稿内容保持',await input.inputValue()==='操作对齐时保留的未提交进展');
 // Inspect the actual gap away from the add button; hover should reveal the button.
 const gap=await page.getByRole('separator',{name:'调整列宽',exact:true}).boundingBox();
 await page.mouse.move(gap.x+gap.width/2,gap.y+gap.height*.7);
 const add=page.locator('.wt-stage-canvas > .wt-stage-insert.is-column').nth(1).locator(':scope > button');
 await page.waitForFunction(()=>Number(getComputedStyle(document.querySelectorAll('.wt-stage-canvas > .wt-stage-insert.is-column > button')[1]).opacity)>.9);
 check('列间整段悬停显现加号',await add.isVisible());
 await add.click();check('加号选择器提示移动已有模块',await page.getByRole('group',{name:'选择内容模块'}).innerText().then(t=>t.includes('移动已有卡片')));
 await page.getByRole('group',{name:'选择内容模块'}).getByRole('button',{name:/详情/}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.wt-stage-column').length===3);
 check('加号移动已有模块且没有复制',await page.locator('[data-stage-module="details"]').count()===1);
 check('布局操作不写正式任务',await page.evaluate(()=>JSON.stringify(window.cardFixture.plugin.tasks))===original);
 await page.locator('[data-module="progress"]').hover();await page.locator('.wt-module-preview').waitFor({state:'visible'});
 const preview=await page.locator('.wt-module-preview').innerText();check('预览不包含未提交草稿或操作按钮',!preview.includes('操作对齐时保留')&&!preview.includes('结束编辑')&&!preview.includes('查看历史'));
 check('拖动结束清除高亮与拖动状态',await page.locator('.is-dragging,.is-drop-target').count()===0);
 // Every view can be removed, including the last; undo and drag restore the same draft node.
 for(const name of ['进展','待办','详情']){
  await page.getByRole('button',{name:`删除${name}视图`,exact:true}).focus();await page.keyboard.press('Enter');
  await page.waitForFunction(id=>!document.querySelector(`.wt-stage-canvas [data-stage-module="${id}"]`),{进展:'progress',待办:'todos',详情:'details'}[name]);
 }
 check('删除最后一个视图仍有重新加入入口',await page.locator('.wt-stage-empty').isVisible());
 const savedEmpty=await page.evaluate(async()=>Object.values((await window.cardFixture.plugin.loadData()).stageLayouts)[0]);check('空展示台布局能够持久保存',savedEmpty.columns.length===0);
 await page.locator('[data-module="progress"]').dragTo(page.locator('.wt-stage-empty'));
 await input.waitFor({state:'visible'});check('重新加入视图恢复原进展草稿',await input.inputValue()==='操作对齐时保留的未提交进展');check('重新加入保留原编辑节点',await editor.evaluate(e=>e.isConnected));
 await reset();
 const resize=page.getByRole('separator',{name:'调整列宽',exact:true});const rb=await resize.boundingBox();
 const preCancel=await page.locator('.wt-stage-column').first().boundingBox();
 await page.mouse.move(rb.x+rb.width/2,rb.y+rb.height/2);await page.mouse.down();await page.mouse.move(rb.x+60,rb.y+rb.height/2,{steps:4});await page.keyboard.press('Escape');await page.mouse.up();
 const postCancel=await page.locator('.wt-stage-column').first().boundingBox();check('Esc取消缩放恢复实际宽度',Math.abs(postCancel.width-preCancel.width)<1);
 await input.dispatchEvent('compositionstart');
 await page.getByRole('button',{name:'删除详情视图',exact:true}).focus();await page.keyboard.press('Enter');
 check('中文组合输入期间删除视图不重排编辑节点',await page.locator('.wt-stage-canvas [data-stage-module="details"]').count()===1&&await editor.evaluate(e=>e.isConnected));
 await input.dispatchEvent('compositionend');
 await page.waitForFunction(()=>!document.querySelector('.wt-stage-area.is-dragging'));
 await page.getByRole('button',{name:'删除待办视图',exact:true}).focus();await page.screenshot({path:'test-results/stage-interactions/delete-view.png'});
 await page.getByRole('button',{name:'结束编辑',exact:true}).click();
 for(const [width,height,appearance] of [[1728,1080,'light'],[1280,900,'dark'],[390,844,'light']]){
  await page.setViewportSize({width,height});await page.evaluate(a=>window.cardFixture.plugin.setAppearance('monochrome',a),appearance);await page.evaluate(()=>document.fonts.ready);
  await page.waitForFunction(()=>!document.querySelector('.work-timeline-view').getAnimations({subtree:true}).some(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity));
  check(`视图操作在${width}宽度没有页面横向溢出`,await page.locator('.view-content').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await page.getByRole('button',{name:'删除待办视图',exact:true}).focus();check(`${width}宽度键盘可发现删除视图`,await page.getByRole('button',{name:'删除待办视图',exact:true}).evaluate(e=>Number(getComputedStyle(e).opacity)>.9));
  await page.screenshot({path:`test-results/stage-interactions/${appearance}-${width}.png`});
 }
 assert.deepEqual(errors,[]);
 mkdirSync('test-results/stage-interactions',{recursive:true});
 await page.locator('.wt-stage-layout-bar').hover();await page.screenshot({path:'test-results/stage-interactions/light.png'});
 writeFileSync('test-results/stage-interactions/result.json',JSON.stringify({at:new Date().toISOString(),checks,errors},null,2));
 console.log(`PASS stage mockup interactions: ${checks.length} checks`);
} finally {await browser.close();}
