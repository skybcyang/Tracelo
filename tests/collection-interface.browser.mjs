import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const bundle = await build({ entryPoints: ['tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width:1280, height:800 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('https://tracelo.test/', r => r.fulfill({ contentType:'text/html', body:'<style>'+readFileSync('tests/helpers/obsidian-host.css','utf8')+readFileSync('styles.css','utf8')+'</style><script type="module">'+bundle.outputFiles[0].text+'</script>' }));
  await page.goto('https://tracelo.test/'); await page.waitForFunction(() => window.cardFixture);
  assert.equal(await page.locator('aside.wt-timeline-column').isVisible(), true, 'daily timeline is a permanent right column');
  assert.equal(await page.locator('.wt-week button').count(), 7);
  const id = await page.evaluate(() => window.cardFixture.ids.payment);
  const card = page.locator(`[data-task-id="${id}"]`);
  assert.equal(await card.locator('.wt-todo-check').count(), 0, 'compact cards reserve checklist contents for expansion');
  assert.equal(await card.locator('.wt-progress-chip').textContent(), '2/4 项完成');
  await card.getByRole('button', { name:'记录进展', exact:true }).click();
  await card.locator('textarea').fill('切换主题时保留的草稿');
  assert.equal(await page.locator('.wt-conversation').isVisible(), true, 'recording leaves the conversation in place');
  for (const theme of ['monochrome','evergreen','graphite','glacier','vermilion']) {
    await page.evaluate(theme => window.cardFixture.plugin.setAppearance(theme, 'light'), theme);
    assert.equal(await card.locator('textarea').inputValue(), '切换主题时保留的草稿');
    assert.equal(await page.evaluate(() => document.body.dataset.traceloTheme), theme);
    const projection = await page.evaluate(async () => JSON.parse(await window.cardFixture.app.vault.adapter.read(window.cardFixture.plugin.state.taskDirectory+'/.tracelo-ui.json')));
    assert.equal(projection.theme, theme);
    await page.evaluate(theme => window.cardFixture.plugin.setAppearance(theme, 'dark'), theme);
    assert.equal(await page.locator('.work-timeline-view').evaluate(el => getComputedStyle(el).colorScheme), 'dark');
  }
  await card.getByRole('button', { name:'收起', exact:true }).click();
  assert.equal(await page.locator('.wt-week button').count(), 7);
  await page.locator('.wt-board-options summary').click();
  const settings = page.locator('.wt-settings-modal');
  await settings.getByLabel('界面主题', {exact:true}).selectOption('evergreen');
  await settings.getByLabel('界面外观', {exact:true}).selectOption('light');
  assert.equal(await settings.getByRole('checkbox',{name:'紧凑任务卡片',exact:true}).count(), 0, 'one toolbar mode replaces the old overlapping preference');
  await settings.getByRole('button',{name:'缩小看板',exact:true}).click();
  assert.equal(await settings.getByRole('button',{name:'恢复看板缩放为100%',exact:true}).innerText(),'95%');
  await settings.getByRole('button',{name:'恢复看板缩放为100%',exact:true}).click();
  await settings.getByRole('button',{name:'完成',exact:true}).click();
  await page.getByRole('button',{name:'展示模式',exact:true}).click();
  await card.locator('.wt-card-todos').waitFor({state:'visible'});
  assert.equal(await card.locator('.wt-card-composer').count(), 0);
  await page.getByRole('button',{name:'展示模式',exact:true}).click();
  await card.locator('.wt-card-todos').waitFor({state:'hidden'});
  await page.evaluate(id=>window.cardFixture.plugin.finishTask(id),id);
  await page.locator('.wt-ended-section summary').click();
  const archive = page.locator('.wt-archive-modal');
  assert.equal(await archive.getByRole('button',{name:'查看已结束任务：完成支付模块',exact:true}).isVisible(),true);
  await archive.getByRole('button',{name:'重新打开：完成支付模块',exact:true}).click();
  await archive.getByText('暂无已结束任务',{exact:true}).waitFor();
  await archive.getByRole('button',{name:'完成',exact:true}).click();
  assert.equal(await card.isVisible(),true);
  await page.locator('.wt-new-task-button').click();
  await page.locator('.wt-new-task-modal').getByRole('button',{name:'记录进展',exact:true}).click();
  const quick = page.locator('.wt-quick-modal');
  assert.equal(await quick.getByRole('button',{name:'撤销移除图片',exact:true}).isVisible(),false);
  assert.equal(await quick.getByRole('textbox',{name:'这次推进了什么？',exact:true}).isVisible(),true);
  await quick.locator('.wt-quick-target').click();
  const chosen = quick.locator('.wt-quick-task[aria-current=true]');
  assert.equal(await chosen.count(), 1, 'plugin picker identifies the current task');
  assert.equal(await quick.locator('.wt-quick-task:not([aria-current])').first().evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'host button defaults cannot override task rows');
  assert.equal(await quick.locator('.wt-composer-footer').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight), true, 'the record action stays in the viewport with the picker open');
  await chosen.click();
  await quick.getByRole('button',{name:'新建任务',exact:true}).click();
  assert.equal(await page.locator('.wt-new-task-modal .wt-capture-tabs').isVisible(),true);
  await page.locator('.wt-new-task-modal').getByRole('button',{name:'取消',exact:true}).click();
  for (const width of [430,720,1280]) {
    await page.setViewportSize({width,height:800});
    assert.equal(await page.locator('.view-content').evaluate(el => el.scrollWidth<=el.clientWidth+1),true,`no overflow ${width}`);
    if (width < 780) {
      await page.getByRole('button',{name:'工作对话',exact:true}).click();
      assert.equal(await page.locator('aside.wt-timeline-column').isVisible(),true);
      await page.getByRole('button',{name:'任务看板',exact:true}).click();
    }
  }
  assert.deepEqual(errors,[]);
  console.log('PASS collection: permanent timeline, visible checklist, inline progress, five themes × two appearances, draft retention, desktop projection, responsive panes');
} finally { await browser.close(); }
