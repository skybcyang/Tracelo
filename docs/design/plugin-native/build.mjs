// Compile the existing plugin against an in-memory host adapter. Production files stay unchanged.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const dir=dirname(fileURLToPath(import.meta.url));
const root=resolve(dir,'../../..');
const dependencies=process.env.TRACELO_PREVIEW_DEPS || resolve(root,'node_modules');
const require=createRequire(import.meta.url);
const {build}=require(resolve(dependencies,'esbuild'));
await build({entryPoints:[resolve(dir,'entry.mjs')],outfile:resolve(dir,'preview.js'),bundle:true,format:'esm',target:'es2022',external:['electron','node:child_process'],nodePaths:[dependencies],alias:{obsidian:resolve(dir,'host-adapter.mjs')}});
await writeFile(resolve(dir,'base.css'),await readFile(resolve(root,'tests/helpers/obsidian-host.css'),'utf8')+'\n'+await readFile(resolve(root,'styles.css'),'utf8'));
console.log('Compiled plugin-native/preview.js and base.css from the current plugin source.');
