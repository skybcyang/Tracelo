import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const dir=dirname(fileURLToPath(import.meta.url));
const root=resolve(dir,'../../..');
const host=resolve(root,'tests/helpers/obsidian-browser.mjs');
await build({entryPoints:[resolve(dir,'mock-entry.mjs')],outfile:resolve(dir,'mock.js'),bundle:true,format:'esm',target:'es2022',external:['electron','node:child_process'],alias:{obsidian:host},plugins:[{name:'preview-real-icons',setup(b){b.onLoad({filter:/obsidian-browser\.mjs$/},async()=>({loader:'js',contents:(await readFile(host,'utf8')).replace(/export function setIcon\(el, name\) \{[\s\S]*?\n\}/,`export function setIcon(el,name) {
  el.firstChild?.remove();
  const key=name.replace(/^lucide-/, '').split('-').map(s=>s[0].toUpperCase()+s.slice(1)).join('');
  const icon=window.lucide?.icons[key];
  if(icon) el.append(window.lucide.createElement(icon));
}`)}))}}]});
await writeFile(resolve(dir,'shared.css'),await readFile(resolve(root,'tests/helpers/obsidian-host.css'),'utf8')+'\n'+await readFile(resolve(root,'styles.css'),'utf8'));
console.log('Mockup built with the original card renderer, task form, and styles.');
