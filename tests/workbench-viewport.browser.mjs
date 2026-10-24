import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const bundle=await build({entryPoints:['tests/helpers/card-fixture.mjs'],bundle:true,write:false,format:'esm',external:['electron','node:child_process'],alias:{obsidian:resolve('tests/helpers/obsidian-browser.mjs')}});
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1280,height:720},reducedMotion:'reduce'});
 await page.route('https://tracelo.test/**',r=>r.fulfill({contentType:'text/html',body:'<meta charset="utf-8"><style>'+readFileSync('tests/helpers/obsidian-host.css','utf8')+readFileSync('styles.css','utf8')+'</style><script type="module">'+bundle.outputFiles[0].text+'</script>'}));
 await page.goto('https://tracelo.test/?workbench=1');await page.waitForFunction(()=>window.cardFixture);
 for(const height of [720,650]) {
  await page.setViewportSize({width:1280,height});
  await page.evaluate(()=>document.fonts.ready);
  const send=page.getByRole('button',{name:'发送',exact:true});
  const box=await send.boundingBox();
  assert.ok(box.y>=0&&box.y+box.height<=height-8,`send stays visible without scrolling at ${height}: ${JSON.stringify(box)}`);
  const hit=await send.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});
  assert.ok(hit,'send is not covered by sidebar clipping');
 }
 await page.locator('.wt-chat-history-query summary').click();
 await page.getByRole('textbox',{name:'历史关键词'}).fill('退款');
 const send=page.getByRole('button',{name:'发送',exact:true});await send.scrollIntoViewIfNeeded();
 const box=await send.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=650,'expanded lookup keeps send reachable');
 const hit=await send.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});
 assert.ok(hit,'expanded lookup keeps send uncovered after scrolling');
 console.log('PASS workbench short viewport: send visible at 720/650, expanded history reachable');
} finally {await browser.close();}
