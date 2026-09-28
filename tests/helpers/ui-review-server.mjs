// Isolated browser preview: all tasks and writes live in the in-memory test vault.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';

createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:4179');
  const bundle = await build({ entryPoints: ['tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  const setup = (url.searchParams.has('dark') ? 'document.body.classList.add("theme-dark");' : '')
    + (url.searchParams.has('settings') ? 'document.querySelector(".view-content").remove(); const settings = window.cardFixture.plugin.settingTabs[0]; document.body.append(settings.containerEl); settings.display();' : '');
  response.end('<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tracelo isolated UI review</title><style>' + readFileSync('tests/helpers/obsidian-host.css', 'utf8') + readFileSync('styles.css', 'utf8') + '</style><script type="module">' + bundle.outputFiles[0].text + setup + '</script></html>');
}).listen(4179, '127.0.0.1', () => console.log('Isolated UI review: http://127.0.0.1:4179'));
