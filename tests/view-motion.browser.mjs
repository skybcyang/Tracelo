import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';

assert.ok(existsSync('src/view-motion.ts'), 'Cross-render motion must have an implementation');
const bundle = await build({ entryPoints: ['src/view-motion.ts'], bundle: true, write: false, format: 'iife', globalName: 'motion' });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
const failures = [];
let checks = 0;
try {
  const page = await browser.newPage();
  await page.setContent(`<style>
    .board{display:flex;gap:20px}.column{width:240px}.wt-card{box-sizing:border-box;height:120px;border:1px solid #aaa;margin-bottom:10px;overflow:hidden}
    .wt-card.is-expanded{height:360px}.wt-card-body{padding:10px}.wt-task-notes{height:100px}.has-focused-task .wt-card:not(.is-selected){opacity:.76}
    .wt-card.is-ended{color:#666}.wt-progress-chip svg{width:20px;height:20px}.wt-progress-value{stroke:green;fill:none}
    .wt-event-list{height:160px;overflow:auto}.wt-event-list li{height:50px}.wt-event-body{background:white}
  </style><div id="root"></div>`);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => {
    const root = document.querySelector('#root');
    window.update = (patch = {}) => {
      const prior = motion.captureViewMotion(root);
      window.state = { open: false, done: 0, selected: null, events: ['old-a'], allEvents: ['old-a', 'old-b'], ended: false, ...window.state, ...patch };
      const s = window.state;
      root.className = s.selected ? 'has-focused-task' : '';
      const card = (id) => `<article data-task-id="${id}" class="wt-card${id === 'a' && s.open ? ' is-expanded' : ''}${s.selected === id ? ' is-selected' : ''}${id === 'a' && s.ended ? ' is-ended' : ''}"><div class="wt-card-body"><button>${id}</button>${id === 'a' ? `<button class="wt-progress-chip${s.done === 2 ? ' is-complete' : ''}"><svg><circle class="wt-progress-value" pathLength="100" stroke-dasharray="${s.done * 50} 100"/></svg></button>${s.open ? `<div class="wt-task-notes">Details</div><section class="wt-card-todos"><div class="wt-todo-row" data-todo-id="todo"><label><input type="checkbox" class="wt-todo-check" ${s.done ? 'checked' : ''}><span class="${s.done ? 'is-done' : ''}">Todo</span></label></div></section><div class="wt-card-composer"><textarea>draft</textarea></div>` : ''}` : ''}</div></article>`;
      root.innerHTML = `<div class="board"><div class="column">${card('a')}${card('b')}</div><div class="column">${card('c')}</div></div><ol class="wt-event-list">${s.events.map(id => `<li data-event-id="${id}"><div class="wt-event-body">${id}</div></li>`).join('')}</ol>`;
      motion.animateViewMotion(root, prior, { eventIds: s.allEvents });
    };
    window.finish = () => root.getAnimations({ subtree: true }).forEach(animation => animation.finish());
    window.freeze = (fraction) => root.getAnimations({ subtree: true }).forEach(animation => { animation.pause(); animation.currentTime = Number(animation.effect.getTiming().duration) * fraction; });
    window.update();
  });
  async function check(name, fn) {
    try { await fn(); checks++; } catch (error) { failures.push(`${name}: ${error.message}`); }
  }
  await check('height grows continuously and stable-column neighbours follow without scaling text', async () => {
    const r = await page.evaluate(() => {
      const card = id => document.querySelector(`[data-task-id="${id}"]`);
      const initial = card('a').getBoundingClientRect().height;
      const other = card('c').getBoundingClientRect().toJSON();
      update({ open: true }); freeze(.35);
      const mid = card('a').getBoundingClientRect();
      const next = card('b').getBoundingClientRect();
      return { initial, mid: mid.height, next: next.top, bottom: mid.bottom, other, currentOther: card('c').getBoundingClientRect().toJSON(), transform: getComputedStyle(card('a')).transform };
    });
    assert.ok(r.mid > r.initial + 1 && r.mid < 359, `expected intermediate height, got ${r.mid}`);
    assert.ok(Math.abs(r.next - r.bottom - 10) < 1, 'neighbour follows animated height');
    assert.equal(r.other.top, r.currentOther.top);
    assert.equal(r.other.left, r.currentOther.left);
    assert.equal(r.transform, 'none');
  });
  await check('reversal starts at the actual interrupted height and releases dimensions', async () => {
    const r = await page.evaluate(() => {
      const card = () => document.querySelector('[data-task-id="a"]');
      const before = card().getBoundingClientRect().height;
      update({ open: false }); freeze(0);
      const after = card().getBoundingClientRect().height;
      finish();
      return { before, after, final: card().getBoundingClientRect().height, inline: card().style.height };
    });
    assert.ok(Math.abs(r.before - r.after) < 1, `interruption jumps ${r.before} → ${r.after}`);
    assert.equal(r.final, 120);
    assert.equal(r.inline, '');
  });
  await check('capturing motion leaves geometry intact for the host reading-anchor capture', async () => {
    const r = await page.evaluate(() => {
      update({ open: true }); freeze(.25);
      const card = document.querySelector('[data-task-id="a"]');
      const before = card.getBoundingClientRect().height;
      motion.captureViewMotion(document.querySelector('#root'));
      const after = card.getBoundingClientRect().height;
      finish();
      return { before, after };
    });
    assert.ok(Math.abs(r.before - r.after) < 1, `capture changed geometry ${r.before} → ${r.after}`);
  });
  await check('focus opacity changes only on selection and remains readable/clickable', async () => {
    const r = await page.evaluate(() => {
      update({ selected: 'a' }); freeze(.4);
      const a = document.querySelector('[data-task-id="a"]');
      const b = document.querySelector('[data-task-id="b"]');
      const opacity = Number(getComputedStyle(b).opacity);
      const pointerEvents = getComputedStyle(b).pointerEvents;
      const selectedOpacity = getComputedStyle(a).opacity;
      finish(); update({ done: 1 });
      return { opacity, pointerEvents, selectedOpacity, unrelatedAnimations: document.querySelector('[data-task-id="b"]').getAnimations().length };
    });
    assert.ok(r.opacity > .76 && r.opacity < 1);
    assert.equal(r.pointerEvents, 'auto');
    assert.equal(r.selectedOpacity, '1');
    assert.equal(r.unrelatedAnimations, 0);
  });
  await check('progress ring interpolates and only final todo receives restrained confirmation', async () => {
    const r = await page.evaluate(() => {
      finish(); update({ open: true }); finish(); update({ done: 2 }); freeze(.35);
      const ring = document.querySelector('.wt-progress-value');
      const value = Number.parseFloat(getComputedStyle(ring).strokeDasharray);
      const chip = document.querySelector('.wt-progress-chip');
      return { value, confirmation: chip.getAnimations().length, todoFeedback: document.querySelector('.wt-todo-row').getAnimations().length, ended: document.querySelector('[data-task-id="a"]').classList.contains('is-ended') };
    });
    assert.ok(r.value > 50 && r.value < 100, `expected intermediate ring, got ${r.value}`);
    assert.ok(r.confirmation > 0);
    assert.equal(r.ended, false);
  });
  await check('browsing previously hidden events never marks them new; append highlights only new id', async () => {
    const r = await page.evaluate(() => {
      finish(); update({ events: ['old-b'] });
      const oldReplay = document.querySelector('[data-event-id="old-b"]').getAnimations({ subtree: true }).length;
      update({ events: ['new', 'old-b'], allEvents: ['old-a', 'old-b', 'new'] });
      const newMotion = document.querySelector('[data-event-id="new"]').getAnimations({ subtree: true }).length;
      const oldMotion = document.querySelector('[data-event-id="old-b"]').getAnimations({ subtree: true }).length;
      finish(); update();
      return { oldReplay, newMotion, oldMotion, repeated: document.querySelector('[data-event-id="new"]').getAnimations({ subtree: true }).length };
    });
    assert.equal(r.oldReplay, 0);
    assert.ok(r.newMotion > 0);
    assert.equal(r.oldMotion, 0);
    assert.equal(r.repeated, 0);
  });
  await check('status feedback affects only the changed card', async () => {
    const r = await page.evaluate(() => {
      finish(); update({ ended: true });
      return { a: document.querySelector('[data-task-id="a"]').getAnimations().length, b: document.querySelector('[data-task-id="b"]').getAnimations().length };
    });
    assert.ok(r.a > 0); assert.equal(r.b, 0);
  });
  await check('100-card mode change animates only visible cards at/after the reading anchor', async () => {
    const r = await page.evaluate(() => {
      const root = document.querySelector('#root'); root.innerHTML = '';
      const pane = document.createElement('div'); pane.className = 'wt-task-column';
      Object.assign(pane.style, { height: '270px', overflow: 'auto', overflowAnchor: 'none' }); root.append(pane);
      const render = open => { pane.innerHTML = Array.from({ length: 100 }, (_, i) => `<article class="wt-card${open ? ' is-expanded' : ''}" data-task-id="many-${i}">Card ${i}</article>`).join(''); };
      render(false); motion.animateViewMotion(pane, motion.captureViewMotion(pane), { eventIds: [] });
      pane.scrollTop = 20 * 130 + 15;
      const anchor = () => pane.querySelector('[data-task-id="many-21"]');
      const offset = () => anchor().getBoundingClientRect().top - pane.getBoundingClientRect().top;
      const before = offset(), prior = motion.captureViewMotion(pane);
      render(true); pane.scrollTop += offset() - before;
      motion.animateViewMotion(pane, prior, { eventIds: [], anchorTaskId: 'many-21' });
      const total = pane.getAnimations({ subtree: true }).length;
      const above = pane.querySelector('[data-task-id="many-20"]').getAnimations().length;
      pane.getAnimations({ subtree: true }).forEach(animation => { animation.pause(); animation.currentTime = 90; });
      const mid = offset();
      pane.getAnimations({ subtree: true }).forEach(animation => animation.finish());
      return { before, mid, end: offset(), total, above };
    });
    assert.ok(r.total > 0 && r.total <= 3, `100 cards created ${r.total} animations`);
    assert.equal(r.above, 0);
    assert.ok(Math.abs(r.before - r.mid) < 1 && Math.abs(r.before - r.end) < 1, `anchor drifted ${r.before} → ${r.mid} → ${r.end}`);
    await page.evaluate(() => { document.querySelector('#root').innerHTML = ''; update(); });
  });
  await check('reduced motion disables all new effects and settles existing animation immediately', async () => {
    await page.evaluate(() => { finish(); update({ open: false }); freeze(.4); });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('#root').getAnimations({ subtree: true }).length === 0);
    const r = await page.evaluate(() => {
      update({ open: true, selected: 'b', done: 0, events: ['newer'], allEvents: ['old-a', 'old-b', 'new', 'newer'] });
      return { animations: document.querySelector('#root').getAnimations({ subtree: true }).length, height: document.querySelector('[data-task-id="a"]').getBoundingClientRect().height };
    });
    assert.equal(r.animations, 0); assert.equal(r.height, 360);
  });
} finally { await browser.close(); }
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`View motion browser checks passed: ${checks}`);
