import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
await build({
  entryPoints: [fileURLToPath(new URL('../src/capture-form.ts', import.meta.url))],
  bundle: true, format: 'iife', globalName: 'TraceloCreateTask', target: 'es2022', minify: true,
  outfile: fileURLToPath(new URL('./Sources/TraceloCapture/Resources/create-task.js', import.meta.url)),
});
