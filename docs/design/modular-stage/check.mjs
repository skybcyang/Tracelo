import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1728,height:1080},reducedMotion:'reduce'});
const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
const check=(name,value)=>{assert.ok(value,name);checks.push(name)};
const snapshot=()=>page.evaluate(()=>window.mockup.getSnapshot());
const widths=()=>page.locator('.module-column').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().width));
const drop=async(source,target)=>{await page.locator(source).dragTo(page.locator(target));await page.waitForTimeout(80)};
try{
await page.goto('http://127.0.0.1:4196/?motion=off');await page.locator('.module-card').first().waitFor();
check('默认布局为等宽两列',Math.abs((await widths())[0]-(await widths())[1])<1);
let heights=await page.locator('.module-column').nth(1).locator('.module-slot').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height));check('默认第二列内两行等高',Math.abs(heights[0]-heights[1])<1);
await page.locator('[data-preview="files"]').hover();await page.waitForTimeout(380);check('缩略图悬停显示只读预览',await page.locator('#module-preview').isVisible());
await page.locator('[data-preview="files"]').click();check('点击缩略图不新增',!(await snapshot()).layout.some(c=>c.rows.some(r=>r.type==='files')));
await page.locator('#task-title').hover();check('离开缩略图收起预览',!(await page.locator('#module-preview').isVisible()));
await page.locator('[data-drop-kind="column"][data-col="1"]').hover();check('列间悬停显现加列按钮',Number(await page.locator('[data-insert-kind="column"][data-col="1"]').evaluate(e=>getComputedStyle(e).opacity))>.5);
await page.locator('#edit-progress').click();await page.locator('#progress-input').fill('布局调整中保留这条未提交进展');
await drop('[data-preview="files"]','[data-drop-kind="column"][data-col="2"]');let s=await snapshot();check('拖入右边新增文件目录列',s.layout.length===3&&s.layout[2].rows[0].type==='files');const equalWidths=await widths();check('新增列默认均分宽度',equalWidths.every(w=>Math.abs(w-equalWidths[0])<1));
check('拖拽结束清除拖动状态',!(await page.locator('body').evaluate(e=>e.classList.contains('dragging-module'))));
check('布局重排保留未提交草稿',await page.locator('#progress-input').inputValue()==='布局调整中保留这条未提交进展');
await drop('[data-preview="details"]','[data-drop-kind="row"][data-col="0"][data-row="1"]');s=await snapshot();check('拖入列中新增行并移动已有模块',s.layout[0].rows.map(r=>r.type).join(',')==='progress,details'&&s.layout.flatMap(c=>c.rows).filter(r=>r.type==='details').length===1);
let grip=page.locator('[data-resize="column"][data-col="1"]');let box=await grip.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+75,box.y+box.height/2,{steps:8});await page.mouse.up();s=await snapshot();check('手动拖动列分界保存宽度比例',s.layout[0].weight>s.layout[1].weight);
await page.locator('[data-resize="column"][data-col="1"]').focus();await page.keyboard.press('Home');s=await snapshot();check('分界线键盘Home恢复两侧等分',Math.abs(s.layout[0].weight-s.layout[1].weight)<.001);
await page.locator('[data-resize="row"][data-col="0"][data-row="1"]').focus();await page.keyboard.press('ArrowDown');s=await snapshot();check('行分界线键盘可调整高度',s.layout[0].rows[0].weight>s.layout[0].rows[1].weight);
const saved=JSON.stringify(s.layout);await page.locator('#cancel-progress').click();await page.locator('#cover-flow [data-task="launch"]').click();check('未调整任务使用默认布局',!(await snapshot()).customLayout&&(await snapshot()).layout.length===2);
await page.locator('#cover-flow [data-task="design"]').click();check('切回任务恢复专属布局',JSON.stringify((await snapshot()).layout)===saved);await page.locator('#edit-progress').click();check('切任务保留草稿',await page.locator('#progress-input').inputValue()==='布局调整中保留这条未提交进展');
await page.reload();check('刷新后仍记住该任务布局',JSON.stringify((await snapshot()).layout)===saved);
await page.locator('#stage-more').click();check('三点菜单有明确标题区归属且可打开',await page.locator('#stage-menu').isVisible());await page.locator('#reset-layout').click();check('恢复默认移除该任务覆盖',!(await snapshot()).customLayout&&(await snapshot()).layout.length===2);await page.locator('#undo-layout').click();check('撤销恢复刚才的自定义布局',JSON.stringify((await snapshot()).layout)===saved);
await page.locator('#layout-mode').click();check('调整布局入口展示全部插入点',await page.locator('#task-stage').evaluate(e=>e.classList.contains('is-arranging')));
await page.locator('[data-insert-kind="row"][data-col="1"][data-row="1"]').click();await page.locator('[data-pick-module="files"]').click();s=await snapshot();check('加号选择模块可用作拖拽的键盘替代',s.layout[1].rows.some(r=>r.type==='files')&&s.layout.flatMap(c=>c.rows).filter(r=>r.type==='files').length===1);
await page.locator('[data-remove-module="details"]').click();check('收回模块不再占展示区',(await snapshot()).layout.flatMap(c=>c.rows).every(r=>r.type!=='details'));
for(const material of ['soft','clear','spatial']){await page.locator('#material-select').selectOption(material);check(`材质切换${material}保持布局`,(await snapshot()).material===material)}
const styles=await page.locator('.filter-options button[aria-pressed="true"]').evaluateAll(es=>es.map(e=>{const s=getComputedStyle(e);return [s.height,s.borderRadius,s.backgroundColor,s.fontSize].join('|')}));check('分组与象限选中样式一致',styles[0]===styles[1]);
await page.locator('[data-group="工作"]').click();await page.locator('[data-quadrant="in"]').click();check('分组和象限联合筛选',(await snapshot()).visible.join(',')==='design,long');
check('无运行时错误',errors.length===0);
const report={at:new Date().toISOString(),scope:'隔离设计原型；合成任务、localStorage布局；不连接正式数据',checks,errors};await writeFile(new URL('./checks.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:checks.length,errors}));
}finally{await browser.close()}
