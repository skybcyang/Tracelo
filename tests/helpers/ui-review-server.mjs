// Isolated browser preview: all tasks and writes live in the in-memory test vault.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';

createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:4179');
  if (url.pathname === '/capture') {
    const resource = 'desktop/Sources/TraceloCapture/Resources/';
    const capture = await build({ stdin: { contents: 'export * from "./src/capture-form"; export {applyQuickOperation,decodeQuickImages} from "./src/quick-operations";', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'TraceloCreateTask' });
    const mode = url.searchParams.get('mode') === 'progress' ? 'progress' : 'create';
    const setup = `
      const task = TraceloCreateTask.buildNewTask({ title:'完成支付模块', groupId:null, groupName:'未分组', important:true, urgent:false, notes:'核对支付、退款与异常流程，保留验收依据。', todos:['确认支付接口协议','验证退款与异常流程'], dueDate:'2026-09-30', initialProgress:'接口联调已通过，继续验证退款与异常流程。' });
      let current = task;
      window.webkit = { messageHandlers:{capture:{async postMessage(message) {
        if (message.action === 'operation') { try {
          const decoded = await TraceloCreateTask.decodeQuickImages(message.operation);
          if(message.operation.attachments) message.operation.attachments.forEach((image,i)=>image.sha256=decoded[i].sha256);
          current = TraceloCreateTask.applyQuickOperation(current, message.operation, []);
          window.capture.update({tasks:[{markdown:TraceloCreateTask.serializeTaskMarkdown(current)}], receipts:[{id:message.operation.id,status:'applied',message:'已写入预览中的临时任务'}]});
        } catch(error) {window.capture.update({receipts:[{id:message.operation.id,status:'failed',message:String(error)}]});} }
        if (message.action === 'submit') window.capture.update({draft:null,saving:false});
      }}}};
    `;
    const theme = ['evergreen','graphite','glacier','vermilion'].includes(url.searchParams.get('theme')) ? url.searchParams.get('theme') : 'evergreen';
    const appearance = url.searchParams.get('appearance') === 'dark' || url.searchParams.has('dark') ? 'dark' : 'light';
    const initial = `window.capture.update({uiSettings:{theme:'${theme}',appearance:'${appearance}'},configured:true,groupsSource:'',location:'临时预览仓库',tasks:[{markdown:TraceloCreateTask.serializeTaskMarkdown(task)}],mode:'${mode}',dark:${url.searchParams.has('dark')}});`;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(readFileSync(resource + 'capture.html', 'utf8')
      .replace('/*PLUGIN_STYLES*/', readFileSync('styles.css', 'utf8'))
      .replace('/*CAPTURE_STYLES*/', readFileSync(resource + 'capture.css', 'utf8') + 'body{background:#f2f2f0;display:grid;place-items:center;padding:24px}.wt-modal.wt-new-task-modal.capture-modal{width:min(554px,100%);min-height:0;max-height:calc(100vh - 48px);box-shadow:0 12px 40px #0002}.theme-dark{background:#191919}@media(max-width:560px){body{padding:12px}.wt-modal.wt-new-task-modal.capture-modal{max-height:calc(100vh - 24px)}}')
      .replace('/*CREATE_TASK_SCRIPT*/', capture.outputFiles[0].text + setup)
      .replace('/*CAPTURE_SCRIPT*/', readFileSync(resource + 'capture.js', 'utf8') + initial));
    return;
  }
  const bundle = await build({ entryPoints: [url.searchParams.has('collection') ? 'tests/helpers/collection-fixture.mjs' : url.searchParams.has('showcase') ? 'tests/helpers/notion-fixture.mjs' : 'tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  const setup = (url.searchParams.has('dark') ? 'document.body.classList.add("theme-dark");' : '')
    + (url.searchParams.has('settings') ? 'document.querySelector(".view-content").remove(); const settings = window.cardFixture.plugin.settingTabs[0]; document.body.append(settings.containerEl); settings.display();' : '');
  response.end('<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tracelo isolated UI review</title><style>' + readFileSync('tests/helpers/obsidian-host.css', 'utf8') + readFileSync('styles.css', 'utf8') + '</style><script type="module">' + bundle.outputFiles[0].text + setup + '</script></html>');
}).listen(4179, '127.0.0.1', () => console.log('Isolated UI review: http://127.0.0.1:4179'));
