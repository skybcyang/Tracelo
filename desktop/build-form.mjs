import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
await build({
  entryPoints: [fileURLToPath(new URL('../src/capture-form.ts', import.meta.url))],
  bundle: true, format: 'iife', globalName: 'TraceloCreateTask', target: 'es2022', minify: true,
  banner: { js: `/*!\n${readFileSync(new URL('../licenses/noto-emoji.txt', import.meta.url), 'utf8')}\n*/` },
  outfile: fileURLToPath(new URL('./Sources/TraceloCapture/Resources/create-task.js', import.meta.url)),
});
