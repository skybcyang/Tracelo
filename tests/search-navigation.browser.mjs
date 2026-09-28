import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({ entryPoints: ['tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
const failures = [];
let checks = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(2000);
  page.on('pageerror', error => failures.push('browser error: ' + error.message));
  await page.route('https://tracelo.test/', route => route.fulfill({ contentType: 'text/html', body: '<style>' + readFileSync('tests/helpers/obsidian-host.css', 'utf8') + readFileSync('styles.css', 'utf8') + '</style><script type="module">' + bundle.outputFiles[0].text + '</script>' }));
  async function check(name, fn) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('https://tracelo.test/');
    await page.waitForFunction(() => window.cardFixture);
    try { await fn(); checks++; console.log('PASS ' + name); } catch (e) { failures.push(name + ': ' + e.message); }
  }
  await check('legacy presentation mode cannot expand cards or expose a mode control', async () => {
    await page.evaluate(async () => {
      const {plugin} = window.cardFixture;
      Object.assign(plugin.state, {presentationMode:true});
      await plugin.setBoardZoom(95);
    });
    assert.equal(await page.getByRole('button',{name:'展示模式',exact:true}).count(),0);
    assert.equal(await page.locator('.wt-card.is-expanded').count(),0);
    await page.getByRole('button',{name:'查看并记录：整理客户反馈',exact:true}).click();
    assert.equal(await page.locator('.wt-card.is-expanded').count(),1);
    await page.getByRole('textbox',{name:'记录当前进展',exact:true}).fill('普通卡片草稿');
    await page.getByRole('button',{name:'关闭进展输入',exact:true}).click();
    assert.equal(await page.locator('.wt-card.is-expanded').count(),0);
    await page.getByRole('button',{name:'查看并记录：整理客户反馈',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'记录当前进展',exact:true}).inputValue(),'普通卡片草稿');
  });
  for (const finalInputFirst of [false, true]) await check(`Chinese composition keeps the focused input until commit (final input first: ${finalInputFirst})`, async () => {
    const result = await page.getByRole('searchbox').evaluate((input, finalInputFirst) => {
      input.focus();
      input.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true}));
      const stages = [];
      for (const value of ['lian', '联', '联diao']) {
        input.value = value;
        input.dispatchEvent(new InputEvent('input', {bubbles:true, isComposing:true, inputType:'insertCompositionText', data:value}));
        stages.push({connected:input.isConnected,focused:document.activeElement===input,cards:document.querySelectorAll('.wt-card').length});
      }
      input.value = '联调';
      // Some engines report the final input before compositionend, others after.
      const commit = () => input.dispatchEvent(new InputEvent('input', {bubbles:true, isComposing:false, inputType:'insertText', data:'联调'}));
      if (finalInputFirst) commit();
      const connectedBeforeEnd = input.isConnected;
      input.dispatchEvent(new CompositionEvent('compositionend', {bubbles:true, data:'联调'}));
      if (!finalInputFirst) commit();
      return {stages,connectedBeforeEnd};
    }, finalInputFirst);
    assert.ok(result.stages.every(s=>s.connected && s.focused && s.cards===4), 'candidate input was detached or lost focus before Chinese text was committed');
    assert.equal(result.connectedBeforeEnd,true,'final input must not interrupt compositionend');
    assert.equal(await page.getByRole('searchbox').inputValue(),'联调');
    assert.equal(await page.getByRole('searchbox').evaluate(el=>el===document.activeElement),true);
    assert.equal(await page.locator('.wt-search-match').filter({hasText:'接口联调已通过'}).count(),1);
    await page.getByRole('searchbox').press('Backspace');
    assert.equal(await page.getByRole('searchbox').inputValue(),'联');
    await page.getByRole('searchbox').fill('refund');
    assert.match(await page.locator('.wt-search-empty').innerText(),/refund/);
  });
  await check('cancelling Chinese composition keeps the existing query and results', async () => {
    await page.getByRole('searchbox').fill('联调');
    const retained = await page.getByRole('searchbox').evaluate(input => {
      input.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true}));
      input.value = '联调zhong';
      input.dispatchEvent(new InputEvent('input', {bubbles:true, isComposing:true}));
      const connected = input.isConnected;
      input.value = '联调';
      input.dispatchEvent(new CompositionEvent('compositionend', {bubbles:true,data:''}));
      return connected;
    });
    assert.equal(retained,true,'cancelled composition must keep its input mounted');
    assert.equal(await page.getByRole('searchbox').inputValue(),'联调');
    assert.equal(await page.locator('.wt-search-match').count(),1);
  });
  await check('old progress results retain source/date and keyboard jump to exact original event', async () => {
    const eventId = await page.evaluate(async () => {
      const { plugin, ids } = window.cardFixture;
      const id = plugin.tasks.find(t => t.id === ids.payment).events.find(e => e.kind === 'progress').id;
      for (let i = 0; i < 18; i++) await plugin.recordProgress(ids.payment, '后续记录 ' + i);
      return id;
    });
    await page.getByRole('searchbox').fill('联调');
    const hit = page.locator('.wt-search-match').filter({ hasText: '接口联调已通过' });
    assert.equal(await hit.count(), 1);
    assert.match(await hit.innerText(), /进展.*2026-/s);
    await hit.press('Enter');
    const target = page.locator(`[data-event-id="${eventId}"]`);
    assert.equal(await target.evaluate(el => el === document.activeElement), true, 'jump should focus original event');
    const located = await target.evaluate(el => {
      const a = el.getBoundingClientRect(), b = el.closest('.wt-timeline-scroll').getBoundingClientRect();
      return a.top >= b.top - 1 && a.top < b.bottom;
    });
    assert.ok(located, 'original event must be in visible history viewport');
    assert.equal(await target.locator('mark').innerText(), '联调');
    assert.equal(await page.getByRole('searchbox').inputValue(), '联调');
  });
  await check('no results explains scope and clear restores all cards and keyboard focus', async () => {
    await page.getByRole('searchbox').fill('不存在XYZ');
    assert.match(await page.locator('.wt-search-empty').innerText(), /未找到.*不存在XYZ/);
    assert.equal(await page.locator('.wt-card-create').count(), 0);
    await page.getByRole('button', { name: '清除搜索', exact: true }).press('Enter');
    assert.equal(await page.locator('.wt-card').count(), 4);
    assert.equal(await page.getByRole('searchbox').evaluate(el => el === document.activeElement), true);
  });
  await check('ended task matches are directly visible without opening the archive', async () => {
    await page.evaluate(async () => { const {plugin,ids}=window.cardFixture; await plugin.finishTask(ids.payment); });
    await page.getByRole('searchbox').fill('联调');
    assert.match(await page.locator('.wt-search-result').innerText(), /已完成/);
    assert.equal(await page.locator('.wt-search-match').filter({hasText:'接口联调已通过'}).isVisible(), true);
  });
  await check('current details result opens current card rather than an unrelated historical event', async () => {
    await page.evaluate(async () => { const {plugin,ids}=window.cardFixture; await plugin.saveTaskNotes(ids.plain, '验收资料包含独特关键词'); });
    await page.getByRole('searchbox').fill('独特关键词');
    await page.locator('.wt-search-match').filter({hasText:'当前详情'}).press('Enter');
    assert.equal(await page.getByRole('searchbox').inputValue(), '');
    assert.match(await page.locator('.wt-card.is-selected .wt-notes-preview').innerText(), /独特关键词/);
  });
  for (const width of [800, 390]) await check(`narrow ${width}px pane switch retains draft and scroll position`, async () => {
    await page.setViewportSize({ width, height: 800 });
    await page.getByRole('button', {name:'查看并记录：整理客户反馈', exact:true}).click();
    await page.getByRole('textbox', {name:'记录当前进展',exact:true}).fill('保留这份草稿');
    const before = await page.locator('.wt-task-column').evaluate(el => { el.scrollTop = 80; return el.scrollTop; });
    await page.getByRole('button', {name:'查看历史',exact:true}).click();
    assert.equal(await page.locator('.wt-task-column').isVisible(), false);
    assert.equal(await page.locator('.wt-timeline-column').isVisible(), true);
    const rect = await page.locator('.wt-timeline-column').boundingBox();
    assert.ok(rect.y >= 0 && rect.y < 250 && rect.y + rect.height <= 801);
    await page.getByRole('button', {name:'返回任务',exact:true}).click();
    assert.equal(await page.getByRole('textbox', {name:'记录当前进展',exact:true}).inputValue(), '保留这份草稿');
    assert.ok(Math.abs(await page.locator('.wt-task-column').evaluate(el=>el.scrollTop) - before) < 2);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  });
  await check('milestones are visibly emphasized without dropping or folding property records', async () => {
    await page.evaluate(async () => { const {plugin,ids}=window.cardFixture; await plugin.finishTask(ids.payment); });
    const all = await page.locator('.wt-event-list li').count();
    assert.ok(all > 10);
    assert.equal(await page.locator('.wt-event-list details').count(), 0);
    for (const kind of ['progress','completed']) {
      const style = await page.locator(`.wt-event-list .is-${kind} .wt-event-body`).first().evaluate(el => ({border:getComputedStyle(el).borderLeftWidth,background:getComputedStyle(el).backgroundColor}));
      assert.ok(parseFloat(style.border) >= 2, kind + ' requires a visible milestone rail');
      assert.notEqual(style.background, 'rgba(0, 0, 0, 0)');
    }
  });
  await check('narrow history keeps its reading position across pane switches and background updates', async () => {
    await page.setViewportSize({width:800,height:800});
    await page.evaluate(async () => { const {plugin,ids}=window.cardFixture; for(let i=0;i<15;i++) await plugin.recordProgress(ids.payment,'追加历史 '+i); });
    await page.getByRole('button',{name:'查看历史',exact:true}).click();
    const pane = page.locator('.wt-timeline-scroll');
    await pane.evaluate(el => { el.scrollTop = 100; });
    await page.getByRole('button',{name:'返回任务',exact:true}).click();
    await page.getByRole('button',{name:'查看历史',exact:true}).click();
    assert.ok(Math.abs(await pane.evaluate(el=>el.scrollTop)-100)<2, 'pane switch moved history');
    await page.getByRole('button',{name:'返回任务',exact:true}).click();
    await page.evaluate(async () => { const {plugin,ids}=window.cardFixture; await plugin.recordProgress(ids.payment,'后台新增进展'); });
    await page.getByRole('button',{name:'查看历史',exact:true}).click();
    assert.ok(Math.abs(await pane.evaluate(el=>el.scrollTop)-100)<2, 'history reading position lost');
  });
  await check('creating a task while viewing narrow history returns to the new card', async () => {
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'查看历史',exact:true}).click();
    await page.locator('.wt-new-task-button').click();
    await page.locator('.wt-modal-title').fill('从历史新建');
    await page.getByRole('button',{name:'创建任务',exact:true}).click();
    await page.locator('.wt-new-task-modal').waitFor({state:'detached'});
    assert.equal(await page.locator('.wt-task-column').isVisible(),true);
    assert.equal(await page.locator('.wt-card.is-expanded .wt-card-title').textContent(),'从历史新建');
  });
} finally { await browser.close(); }
if (failures.length) throw new Error(failures.join('\n'));
console.log(`${checks} search/navigation checks passed`);
