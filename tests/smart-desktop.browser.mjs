import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = 'desktop/Sources/TraceloCapture/Resources/';
const bundle = await build({ stdin: { contents: 'export * from "./src/capture-form"; export {serializeTaskMarkdown, parseTaskMarkdown} from "./src/archive"; export {createTask,addTodo} from "./src/domain";', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'TraceloCreateTask' });
const html = readFileSync(root + 'capture.html', 'utf8').replace('/*PLUGIN_STYLES*/', readFileSync('styles.css', 'utf8')).replace('/*CAPTURE_STYLES*/', readFileSync(root + 'capture.css', 'utf8')).replace('/*CREATE_TASK_SCRIPT*/', bundle.outputFiles[0].text).replace('/*CAPTURE_SCRIPT*/', readFileSync(root + 'capture.js', 'utf8'));
const browser = await chromium.launch({headless:true});
try {
  for (const platform of ['mac','windows']) {
    const page = await browser.newPage({viewport:{width:560,height:760}, reducedMotion:'reduce'});
    page.setDefaultTimeout(6000);
    const openSmart = async () => {
      if (!await page.getByRole('button',{name:'一句话整理',exact:true}).isVisible()) await page.getByRole('button',{name:'新建任务',exact:true}).click();
      await page.getByRole('button',{name:'一句话整理',exact:true}).click();
    };
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(platform => {
      window.smartStore={}; window.workspaceStores={'qa-workspace':window.smartStore}; window.messages=[];
      const postMessage=message=>{
        window.messages.push(message);
        if(message.action!=='smart') return;
        const {id,method,params}=message;
        const store=window.workspaceStores[message.workspace]??=( {} );
        if(method==='draft' && window.holdCreateDraft && params.scope.startsWith('createRequest:')) {window.heldDraft=message;return;}
        const reply=(result,error)=>window.capture.update({smartReply:{id,result,error}});
        if(method==='draft' && window.holdDraft) {window.releaseDraft=()=>{store[params.scope]=params.value;reply(null);};return;}
        if(method==='read' && window.holdRead) {window.releaseRead=()=>reply({config:{baseUrl:'https://example.test/v1',model:'test-model',apiKey:'test-direct-token-1234567890'},drafts:{...store}});return;}
        setTimeout(()=>{
          if(method==='read') reply({config:{baseUrl:'https://example.test/v1',model:'test-model',keyFile:'/tmp/test-key'},drafts:{...store}});
          if(method==='draft') {if(window.failDraft) reply(null,'模拟草稿写入失败'); else {store[params.scope]=params.value;reply(null);}}
          if(method==='configure') reply(null);
          if(method==='pickKey') reply('/tmp/selected-key');
          if(method==='request') {
            const context=JSON.parse(JSON.parse(params.request.body).messages.at(-1).content);
            const value=context.task ? {text:'已抓日志',completedTodoIds:['logs'],warnings:[]} : {title:'桌面一句话任务',notes:'',groupId:null,important:false,urgent:false,dueDate:null,todos:[],initialProgress:'',warnings:[]};
            reply({status:200,text:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]})});
          }
          if(method==='create') {window.created=params.request; if(window.failCreate) reply(null,'模拟磁盘写入失败'); else reply(null);}
          if(method==='progress') {window.queued=params.operation;reply('queued');}
        },0);
      };
      if(platform==='windows'){window.chrome??={};window.chrome.webview={postMessage};}
      else window.webkit={messageHandlers:{capture:{postMessage}}};
    },platform);
    await page.goto('about:blank');await page.setContent(html);await page.waitForFunction(()=>window.capture);
    await page.evaluate(()=>{
      const shared=TraceloCreateTask;
      const task=shared.addTodo(shared.createTask({title:'已有任务',groupId:null,groupName:'未分组',important:false,urgent:false},new Date(),'task','created'),'抓日志',new Date(),'logs','todo');
      window.capture.update({workspace:'qa-workspace',configured:true,groupsSource:'',tasks:[{markdown:shared.serializeTaskMarkdown(task)}]});
    });
    assert.deepEqual(await page.locator('.wt-capture-tabs button').allTextContents(),['新建任务','记录进展']);
    await page.evaluate(()=>window.holdRead=true);
    await openSmart();
    await page.waitForFunction(()=>window.releaseRead);
    await page.locator('.wt-capture-tabs').getByRole('button',{name:'记录进展',exact:true}).click();
    await page.evaluate(async()=>{window.holdRead=false;window.releaseRead();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
    assert.equal(await page.locator('.wt-smart-modal').count(),0,'a late read cannot replace the newly selected tab');
    await page.getByRole('button',{name:'新建任务',exact:true}).click();
    await openSmart();
    await page.waitForFunction(()=>document.querySelector('.wt-smart-modal') || document.querySelector('[role=alert]')?.textContent);
    assert.equal(await page.locator('.wt-smart-modal').count(),1,JSON.stringify(await page.locator('[role=alert]').allTextContents()));
    const modal=page.locator('.wt-smart-modal');
    assert.equal(await page.locator('.wt-capture-tabs').evaluate(el=>!el.closest('[inert]') && !document.querySelector('dialog:modal')),true,'smart capture is a tab panel, not a modal');
    assert.equal(await page.getByRole('button',{name:'一句话整理',exact:true}).getAttribute('aria-pressed'),'true');
    await modal.getByRole('textbox',{name:'说说要做的事',exact:true,includeHidden:true}).fill('切换后仍保留');
    await page.waitForFunction(()=>window.smartStore.create?.includes('切换后仍保留'));
    await page.evaluate(()=>window.holdDraft=true);
    await page.getByRole('button',{name:'新建任务',exact:true}).click();
    await page.waitForFunction(()=>window.releaseDraft);
    await openSmart();
    await page.evaluate(async()=>{window.holdDraft=false;window.releaseDraft();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
    assert.equal(await page.getByRole('button',{name:'一句话整理',exact:true}).getAttribute('aria-pressed'),'true','latest tab selection wins even during a pending draft flush');
    await modal.getByRole('textbox',{name:'说说要做的事',exact:true,includeHidden:true}).dispatchEvent('compositionstart');
    await page.getByRole('button',{name:'新建任务',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'一句话整理',exact:true}).getAttribute('aria-pressed'),'true','composition cannot detach the active input');
    await modal.getByRole('textbox',{name:'说说要做的事',exact:true,includeHidden:true}).dispatchEvent('compositionend');
    await page.getByRole('button',{name:'新建任务',exact:true}).click();
    await modal.waitFor({state:'detached'});
    await page.getByRole('textbox',{name:'任务名称',exact:true}).fill('普通新建草稿');
    await openSmart();
    assert.equal(await modal.getByRole('textbox',{name:'说说要做的事',exact:true,includeHidden:true}).inputValue(),'切换后仍保留');
    await page.getByRole('button',{name:'新建任务',exact:true}).click();
    await modal.waitFor({state:'detached'});
    assert.equal(await page.getByRole('textbox',{name:'任务名称',exact:true}).inputValue(),'普通新建草稿');
    await page.locator('.wt-capture-tabs').getByRole('button',{name:'记录进展',exact:true}).click();
    await page.getByRole('textbox',{name:'这次推进了什么？',exact:true}).fill('普通进展草稿');
    await openSmart();
    await modal.getByRole('textbox',{name:'说说要做的事',exact:true,includeHidden:true}).waitFor();
    await page.locator('.wt-capture-tabs').getByRole('button',{name:'记录进展',exact:true}).click();
    await modal.waitFor({state:'detached'});
    assert.equal(await page.getByRole('textbox',{name:'这次推进了什么？',exact:true}).inputValue(),'普通进展草稿');
    await openSmart();
    await page.waitForFunction(()=>window.messages.findLast(m=>m.action==='resize')?.height<520);
    const compactHeight=await page.evaluate(()=>window.messages.findLast(m=>m.action==='resize').height);
    assert.ok(compactHeight>=350,'content and footer have sufficient space');
    await page.setViewportSize({width:560,height:compactHeight});
    mkdirSync('test-results/smart-capture',{recursive:true});
    await page.screenshot({path:`test-results/smart-capture/desktop-${platform}-input.png`});
    await page.evaluate(()=>window.capture.update({dark:true}));
    await page.screenshot({path:`test-results/smart-capture/desktop-${platform}-dark-input.png`});
    await page.evaluate(()=>window.capture.update({dark:false}));
    assert.equal(await page.locator('#close').evaluate(el=>el.getBoundingClientRect().left>innerWidth-50),true,'window close stays in the shared top-right position');
    await modal.getByRole('textbox',{name:'说说要做的事',exact:true,includeHidden:true}).fill('帮我创建一个任务');
    await modal.getByRole('button',{name:'模型设置',exact:true}).click();
    const settings=page.locator('.wt-smart-settings');
    const key = settings.getByLabel('API Key', {exact:true});
    await key.fill('test-direct-token-1234567890');
    assert.equal(await key.getAttribute('type'),'password');
    await settings.getByRole('button',{name:'显示密钥',exact:true}).click();
    assert.equal(await key.getAttribute('type'),'text');
    await settings.getByRole('button',{name:'隐藏密钥',exact:true}).click();
    for(const [width,height] of [[560,compactHeight],[390,450]]) {
      await page.setViewportSize({width,height});
      assert.equal(await settings.getByRole('button',{name:'保存设置',exact:true}).evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight),true,'settings save stays reachable');
      assert.equal(await settings.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
    }
    await page.setViewportSize({width:560,height:520});
    await page.screenshot({path:`test-results/smart-capture/desktop-${platform}-settings.png`});
    assert.equal(await settings.getByRole('button',{name:'选择密钥文件',exact:true}).count(),0);
    await settings.getByRole('button',{name:'测试连接',exact:true}).click();
    await settings.getByRole('status').filter({hasText:'连接成功'}).waitFor();
    await settings.getByRole('button',{name:'保存设置',exact:true}).click();
    await settings.waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>window.messages.findLast(m=>m.method==='configure').params.config.apiKey),'test-direct-token-1234567890');
    assert.equal(await page.evaluate(()=>window.messages.findLast(m=>m.method==='configure').params.config.keyFile),'');
    assert.ok(await modal.evaluate(el=>el.getBoundingClientRect().left)<=1,'smart capture uses the native content surface');
    assert.equal(await modal.getByRole('button',{name:'关闭',exact:true}).evaluate(el=>getComputedStyle(el).borderTopStyle),'solid','shared buttons never use browser bevels');
    await page.evaluate(()=>window.failDraft=true);
    await page.getByRole('button',{name:'新建任务',exact:true}).click();
    await modal.getByRole('alert').filter({hasText:'草稿未能保存'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'一句话整理',exact:true}).getAttribute('aria-pressed'),'true','failed draft writes keep the current tab selected');
    assert.equal(await modal.getByRole('textbox',{name:'说说要做的事',exact:true,includeHidden:true}).inputValue(),'帮我创建一个任务');
    await page.evaluate(()=>window.failDraft=false);
    await modal.getByRole('button',{name:'关闭',exact:true}).click();
    await modal.waitFor({state:'detached'});
    await openSmart();
    assert.equal(await modal.getByRole('textbox',{name:'说说要做的事',exact:true,includeHidden:true}).inputValue(),'帮我创建一个任务');
    await modal.getByRole('button',{name:'整理成任务',exact:true}).click();
    await modal.locator('#task-title').fill('桌面确认后的任务');
    assert.equal(await modal.getByRole('textbox',{name:'说说要做的事',exact:true,includeHidden:true}).isVisible(),false);
    assert.equal(await page.locator('.wt-capture-tabs').getByRole('button',{name:'新建任务',exact:true}).getAttribute('aria-pressed'),'true');
    await modal.getByRole('button',{name:'返回原文',exact:true}).click();
    assert.equal(await modal.getByRole('textbox',{name:'说说要做的事',exact:true,includeHidden:true}).inputValue(),'帮我创建一个任务');
    await modal.getByRole('button',{name:'查看整理结果',exact:true}).click();
    assert.equal(await modal.locator('#task-title').inputValue(),'桌面确认后的任务');
    await page.setViewportSize({width:390,height:450});
    assert.equal(await modal.getByRole('button',{name:'创建任务',exact:true}).evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight),true,'confirmation submit is pinned in a short window');
    await page.setViewportSize({width:560,height:760});
    await page.screenshot({path:`test-results/smart-capture/desktop-${platform}-create-result.png`});
    await modal.locator('input[type=file]').setInputFiles({name:'capture.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64')});
    await page.waitForFunction(()=>!document.querySelector('.wt-smart-modal #submit').disabled);
    await page.evaluate(()=>window.failCreate=true);
    await modal.getByRole('button',{name:'创建任务',exact:true}).click();
    await modal.getByRole('alert').filter({hasText:'模拟磁盘写入失败'}).waitFor();
    const attempt=await page.evaluate(()=>window.created);
    await page.evaluate(()=>window.failCreate=false);
    await modal.getByRole('button',{name:'创建任务',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.wt-smart-modal') || [...document.querySelectorAll('.wt-smart-modal [role=alert]')].some(e=>e.textContent));
    assert.deepEqual(await modal.locator('[role=alert]').allTextContents(),[],JSON.stringify(await page.evaluate(()=>({errors:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent),messages:window.messages.filter(m=>m.action==='smart').map(m=>m.method)}))));
    await modal.waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>TraceloCreateTask.parseTaskMarkdown(window.created.markdown).title),'桌面确认后的任务');
    assert.match(await page.evaluate(()=>window.created.markdown),/^<!-- work-timeline-task:v1\n/,'native publisher requires the shared legacy transport envelope');
    assert.deepEqual(await page.evaluate(()=>window.created),attempt,'retry preserves exact archive and attachments');
    assert.equal(attempt.attachments.length,1);
    assert.doesNotMatch(attempt.markdown,/tracelo-draft:/);
    await page.waitForFunction(()=>!Object.keys(window.smartStore).some(key=>key.startsWith('createRequest:')&&window.smartStore[key]));
    await page.locator('.wt-capture-tabs').getByRole('button',{name:'记录进展',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'一句话记录进展',exact:true}).count(),0,'quick progress has no separate AI entry');
    const progressInput=page.getByRole('textbox',{name:'这次推进了什么？',exact:true});
    assert.equal(await progressInput.inputValue(),'普通进展草稿');
    await progressInput.fill('日志抓完了');
    for(const [width,height] of [[560,760],[390,450]]) {
      await page.setViewportSize({width,height});
      assert.equal(await page.locator('.wt-quick-progress .wt-composer-footer button[type=submit]').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight),true,'direct progress submit stays reachable');
      assert.equal(await page.locator('.wt-quick-progress').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'no horizontal overflow');
    }
    await page.setViewportSize({width:560,height:760});
    await page.screenshot({path:`test-results/smart-capture/desktop-${platform}-direct-progress.png`});
    await openSmart();
    await page.locator('.wt-capture-tabs').getByRole('button',{name:'记录进展',exact:true}).click();
    await modal.waitFor({state:'detached'});
    assert.equal(await progressInput.inputValue(),'日志抓完了','switching to AI creation preserves direct progress');
    assert.deepEqual(errors,[]);
    assert.equal(await page.evaluate(()=>window.messages.filter(m=>m.method==='progress').length),0,'direct progress does not request AI progress');
    await page.getByRole('button',{name:'新建任务',exact:true}).click();
    await openSmart();
    await modal.getByRole('textbox',{name:'说说要做的事',exact:true,includeHidden:true}).fill('只能留在原目录的任务');
    await modal.getByRole('button',{name:'整理成任务',exact:true}).click();
    await page.evaluate(()=>window.holdCreateDraft=true);
    await modal.getByRole('button',{name:'创建任务',exact:true}).click();
    await page.waitForFunction(()=>window.heldDraft);
    await page.evaluate(()=>{
      window.capture.update({workspace:'other-workspace',configured:true,groupsSource:'',tasks:[]});
      window.capture.update({smartReply:{id:window.heldDraft.id,result:null}});
    });
    await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,30)));
    assert.equal(await page.evaluate(()=>window.messages.some(m=>m.method==='create'&&m.workspace==='other-workspace')),false,'late save must not publish the old task in a new workspace');
    await modal.waitFor({state:'detached'});
    await openSmart();
    assert.equal(await modal.getByRole('textbox',{name:'说说要做的事',exact:true,includeHidden:true}).inputValue(),'','new workspace starts with its own draft');
    await modal.getByRole('button',{name:'关闭',exact:true}).click();
    await modal.waitFor({state:'detached'});
    await page.evaluate(()=>{window.holdCreateDraft=false;window.capture.update({workspace:'qa-workspace',configured:true,groupsSource:'',tasks:[]});});
    await openSmart();
    assert.equal(await modal.getByRole('textbox',{name:'说说要做的事',exact:true,includeHidden:true}).inputValue(),'只能留在原目录的任务');
    console.log('PASS '+platform+': masked key, connection, confirmed AI creation, direct progress without AI entry and independent drafts');
    await page.close();
  }
} finally {await browser.close();}
