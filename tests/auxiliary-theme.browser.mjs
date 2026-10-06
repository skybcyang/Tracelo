import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Exercise production modals against an independent host stylesheet. Explicit
// plugin appearance must not change when the surrounding Obsidian theme changes.
const bundle = await build({ entryPoints: ['tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
const failures = [];
let checks = 0;
const check = (name, run) => { try { run(); checks++; } catch (error) { failures.push(`${name}: ${error.message}`); } };
const rgb = value => value.startsWith('#') ? value.slice(1).match(/../g).map(v => parseInt(v,16)) : value.match(/[\d.]+/g).slice(0,3).map(Number);
const luminance = value => rgb(value).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum,v,i) => sum + v * [.2126,.7152,.0722][i],0);
const contrast = (a,b) => (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
try {
  const page = await browser.newPage({ viewport: { width:1280,height:800 }, reducedMotion:'reduce' });
  page.setDefaultTimeout(4000);
  const errors=[]; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://tracelo.test/', route => route.fulfill({ contentType:'text/html',body:'<style>'+readFileSync('tests/helpers/obsidian-host.css','utf8')+readFileSync('styles.css','utf8')+'</style><script type="module">'+bundle.outputFiles[0].text+'</script>' }));
  await page.goto('https://tracelo.test/'); await page.waitForFunction(() => window.cardFixture);
  await page.getByRole('button',{name:'管理分组',exact:true}).click();
  for (const theme of ['monochrome','evergreen','graphite','glacier','vermilion']) {
    for (const appearance of ['light','dark','system']) {
      const snapshots=[];
      for (const hostDark of [false,true]) {
        await page.evaluate(async ({theme,appearance,hostDark}) => {
          document.body.classList.toggle('theme-dark',hostDark);
          await window.cardFixture.plugin.setAppearance(theme,appearance);
        },{theme,appearance,hostDark});
        const values=await page.locator('.wt-group-manager-row').first().evaluate(el => {
          const style=getComputedStyle(el), parent=getComputedStyle(el.closest('.wt-modal'));
          const color=getComputedStyle(el.querySelector('.wt-group-count')).color;
          const name=getComputedStyle(el.querySelector('.wt-group-name')).color;
          const rgba=style.backgroundColor.match(/[\d.]+/g).map(Number), base=parent.backgroundColor.match(/[\d.]+/g).map(Number);
          const alpha=rgba[3] ?? 1;
          return { background:`rgb(${rgba.slice(0,3).map((v,i)=>v*alpha+base[i]*(1-alpha)).join(',')})`, color,name,radius:style.borderRadius };
        });
        const label=`${theme}/${appearance}/host-${hostDark?'dark':'light'}`;
        check(`${label} group text contrast`,()=>assert.ok(contrast(values.color,values.background)>=4.5,JSON.stringify(values)));
        snapshots.push(values);
      }
      if (appearance !== 'system') check(`${theme}/${appearance} independent of host`,()=>assert.deepEqual(snapshots[0],snapshots[1]));
    }
  }
  // The stub lacks the host's modal-close chrome; remove only its disposable UI.
  await page.evaluate(()=>document.querySelector('.modal-container').remove());
  await page.getByRole('button',{name:'新建任务',exact:true}).click();
  const modal=page.locator('.wt-new-task-modal');
  await modal.locator('input[type=file]').setInputFiles({name:'theme.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64')});
  await modal.getByRole('button',{name:'预览图片：theme.png',exact:true}).waitFor();
  for (const theme of ['monochrome','evergreen','graphite','glacier','vermilion']) {
    for (const appearance of ['light','dark']) {
      await page.evaluate(async ({theme,appearance})=>{
        document.body.classList.toggle('theme-dark',appearance==='light');
        await window.cardFixture.plugin.setAppearance(theme,appearance);
      },{theme,appearance});
      const selected=await modal.locator('.wt-quadrant-option:has(input:checked)').evaluate(el=>({bg:getComputedStyle(el).backgroundColor,image:getComputedStyle(el).backgroundImage,tint:getComputedStyle(el).getPropertyValue('--wt-tint').trim()}));
      check(`${theme}/${appearance} selected quadrant`,()=>{assert.deepEqual(rgb(selected.bg),rgb(selected.tint));assert.equal(selected.image,'none');});
      await modal.locator('.wt-quadrant-option:not(:has(input:checked))').first().hover();
      await page.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});
      const hover=await modal.locator('.wt-quadrant-option:not(:has(input:checked))').first().evaluate(el=>({bg:getComputedStyle(el).backgroundColor,soft:getComputedStyle(el).getPropertyValue('--wt-soft').trim()}));
      check(`${theme}/${appearance} quadrant hover`,()=>assert.deepEqual(rgb(hover.bg),rgb(hover.soft)));
      const actions=await modal.locator('.wt-modal-actions button').evaluateAll(els=>els.map(el=>getComputedStyle(el).borderRadius));
      check(`${theme}/${appearance} action shape`,()=>assert.equal(new Set(actions).size,1));
      await modal.getByRole('button',{name:'预览图片：theme.png',exact:true}).click();
      const preview=page.locator('.wt-image-preview');
      const visual=await preview.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,scheme:getComputedStyle(el).colorScheme}));
      const cardColor=await modal.evaluate(el=>getComputedStyle(el).backgroundColor);
      check(`${theme}/${appearance} image preview`,()=>{assert.equal(visual.bg,cardColor);assert.equal(visual.scheme,appearance);});
      const close=await preview.getByRole('button',{name:'关闭图片预览',exact:true}).evaluate(el=>({fg:getComputedStyle(el).color,text:getComputedStyle(el).getPropertyValue('--wt-text').trim()}));
      check(`${theme}/${appearance} preview control`,()=>assert.deepEqual(rgb(close.fg),rgb(close.text)));
      await preview.getByRole('button',{name:'关闭图片预览',exact:true}).click();
    }
  }
  await modal.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('button',{name:'管理分组',exact:true}).click();
  for (const width of [390,720,1280]) {
    await page.setViewportSize({width,height:800});
    const fits=await page.locator('.wt-group-manager-modal').evaluate(el=>el.scrollWidth<=el.clientWidth+1 && el.getBoundingClientRect().right<=innerWidth);
    check(`group content fits ${width}`,()=>assert.ok(fits));
  }
  await page.evaluate(async()=>{
    document.querySelector('.modal-container').remove();
    await window.cardFixture.plugin.finishTask(window.cardFixture.ids.payment);
  });
  await page.locator('.wt-ended-section summary').click();
  for (const appearance of ['light','dark']) {
    await page.evaluate(appearance=>window.cardFixture.plugin.setAppearance('graphite',appearance),appearance);
    const reopen=await page.getByRole('button',{name:'重新打开：完成支付模块',exact:true}).evaluate(el=>({fg:getComputedStyle(el).color,text:getComputedStyle(el).getPropertyValue('--wt-text').trim(),shadow:getComputedStyle(el).boxShadow}));
    check(`archive ${appearance} action`,()=>{assert.deepEqual(rgb(reopen.fg),rgb(reopen.text));assert.equal(reopen.shadow,'none');});
  }
  assert.deepEqual(errors,[]);
  assert.equal(failures.length,0,failures.join('\n'));
  console.log(`PASS ${checks} auxiliary theme checks: group contrast, independent appearance, action shapes, image previews and narrow dialogs`);
} finally { await browser.close(); }
