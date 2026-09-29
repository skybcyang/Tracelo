// Isolated study: production cards, synthetic tasks, in-memory vault only.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {build} from 'esbuild';
const root=resolve(import.meta.dirname,'../../..');
createServer(async(request,response)=>{
  try {
    const bundle=await build({entryPoints:[resolve(import.meta.dirname,'study.mjs')],bundle:true,write:false,format:'esm',external:['electron','node:child_process'],alias:{obsidian:resolve(root,'tests/helpers/obsidian-browser.mjs')}});
    response.setHeader('Content-Type','text/html; charset=utf-8');
    response.end('<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tracelo · 卡片高度实验</title><style>'+['tests/helpers/obsidian-host.css','styles.css','docs/design/card-height-lab/study.css'].map(file=>readFileSync(resolve(root,file),'utf8')).join('\n')+'</style><script type="module">'+bundle.outputFiles[0].text+'</script></html>');
  } catch(error) {response.statusCode=500;response.end(String(error));}
}).listen(4191,'127.0.0.1',()=>console.log('Card height study: http://127.0.0.1:4191'));
