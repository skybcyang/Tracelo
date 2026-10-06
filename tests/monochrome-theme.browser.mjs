import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({entryPoints:['tests/helpers/collection-fixture.mjs'],bundle:true,write:false,format:'esm',external:['electron','node:child_process'],alias:{obsidian:resolve('tests/helpers/obsidian-browser.mjs')}});
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('https://tracelo.test/', r => r.fulfill({contentType:'text/html',body:'<style>'+readFileSync('tests/helpers/obsidian-host.css','utf8')+readFileSync('styles.css','utf8')+'</style><script type="module">'+bundle.outputFiles[0].text+'</script>'}));
  await page.goto('https://tracelo.test/'); await page.waitForFunction(() => window.cardFixture);
  assert.equal(await page.locator('body').getAttribute('data-tracelo-theme'), 'monochrome');
  await page.locator('.wt-board-options > summary').click();
  assert.deepEqual(await page.getByRole('combobox',{name:'界面主题'}).locator('option').allTextContents(), ['素白','矿物绿','石墨紫','冰川蓝','暖白朱砂']);
  await page.getByRole('combobox',{name:'界面主题'}).selectOption('evergreen');
  await page.getByRole('combobox',{name:'界面主题'}).selectOption('monochrome');
  assert.equal(await page.evaluate(() => window.cardFixture.plugin.state.theme), 'monochrome');
  // The fixture has no host modal close chrome.
  await page.evaluate(() => document.querySelector('.modal-container').remove());
  const brand = await page.locator('.wt-brand-mark').innerHTML();
  const geometry = () => page.locator('.wt-header, .wt-board, .wt-card').evaluateAll(els => els.map(el => {
    const {x,y,width,height}=el.getBoundingClientRect(), s=getComputedStyle(el);
    return {x,y,width,height,radius:s.borderRadius,font:s.font};
  }));
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    for (const mode of ['light','dark']) {
      await page.evaluate(mode => window.cardFixture.plugin.setAppearance('evergreen',mode),mode);
      await page.waitForTimeout(120);
      const before = await geometry();
      await page.evaluate(mode => window.cardFixture.plugin.setAppearance('monochrome',mode),mode);
      await page.waitForTimeout(120);
      assert.deepEqual(await geometry(), before, 'new theme changes colors only');
      const colors = await page.locator('.work-timeline-view').evaluate(el => {
        const s=getComputedStyle(el);
        return ['bg','card','raised','soft','text','muted','line','accent','on-accent','accent-text','tint','red','danger-bg','warning','warning-bg','g1','g2','g3'].map(token => s.getPropertyValue('--wt-'+token).trim());
      });
      for (const color of colors) assert.match(color, /^#([a-f\d]{2})\1\1$/i, 'all palette tokens are neutral: '+color);
      const luminance = hex => { const v=parseInt(hex.slice(1,3),16)/255; return v<=.04045?v/12.92:((v+.055)/1.055)**2.4; };
      for (const index of [4,5,15,16,17]) {
        const fg=luminance(colors[index]), bg=luminance(colors[0]);
        assert.ok((Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)>=4.5, 'body and group text remains readable');
      }
      if (process.env.THEME_SCREENSHOTS) await page.screenshot({path:`${process.env.THEME_SCREENSHOTS}/monochrome-${mode}-${width}.png`});
    }
  }
  for (const theme of ['monochrome','evergreen','graphite','glacier','vermilion']) {
    await page.evaluate(theme => window.cardFixture.plugin.setAppearance(theme,'light'),theme);
    assert.equal(await page.locator('.wt-brand-mark').innerHTML(),brand);
    assert.ok(await page.locator('.wt-brand-mark').evaluate(el => {
      const a=el.getBoundingClientRect(), b=el.querySelector('svg').getBoundingClientRect();
      return Math.abs(a.x+a.width/2-b.x-b.width/2)<.1 && Math.abs(a.y+a.height/2-b.y-b.height/2)<.1;
    }), 'logo must be centered, including the former circular theme');
  }
  await page.getByRole('button',{name:'新建任务',exact:true}).click();
  assert.equal(await page.locator('.wt-capture-brand').innerHTML(), brand, 'modal and header share the mark');
  assert.deepEqual(errors,[]);
  console.log('Monochrome: defaults, theme picker, unchanged layout, neutral palette, shared centered brand passed.');
} finally { await browser.close(); }
