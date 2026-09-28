import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

// Explicit opt-in: reads a vault, writes only into a fresh OS temporary directory.
// Never initialize an ArchiveStore on the source vault: initialization may repair it.
assert.ok(process.argv[2], 'Usage: node tests/verify-vault-roundtrip.mjs /absolute/vault');
const vault = resolve(process.argv[2]);
const compiled = await build({ stdin: { contents: `
  export { parseTaskMarkdown, parseGroupArchive, normalizePluginState, createDefaultState } from './src/archive.ts';
  export { ArchiveStore } from './src/archive-store.ts';
  export { exportBundle, importBundle } from './src/transfer.ts';
  export { DiskAdapter } from './tests/helpers/disk-adapter.ts';
`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm' });
const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const { parseTaskMarkdown, parseGroupArchive, normalizePluginState, createDefaultState, ArchiveStore, exportBundle, importBundle, DiskAdapter } = api;
const state = normalizePluginState(JSON.parse(await readFile(join(vault, '.obsidian/plugins/work-timeline/data.json'), 'utf8')));
const directory = state.taskDirectory;
const source = new DiskAdapter(vault);
for (const name of ['write', 'writeBinary', 'mkdir', 'rename', 'copy', 'remove', 'rmdir']) {
  source[name] = async () => { throw new Error('Source vault is read-only: ' + name); };
}
async function snapshot() {
  const hashes = {};
  async function visit(path) {
    for (const entry of await readdir(join(vault, path), { withFileTypes: true })) {
      const child = path + '/' + entry.name;
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) hashes[child] = createHash('sha256').update(Buffer.from(await source.readBinary(child))).digest('hex');
    }
  }
  await visit(directory);
  return hashes;
}
const before = await snapshot();
const tasks = [];
for (const path of Object.keys(before).filter(path => path.endsWith('.md'))) {
  const text = await source.read(path);
  if (text.startsWith('<!-- work-timeline-task:v1')) tasks.push(parseTaskMarkdown(text));
}
assert.ok(tasks.length, 'No formal task archives found');
const groups = parseGroupArchive(await source.read(directory + '/_groups.md'));
const bundle = await exportBundle(source, tasks, groups, state, directory);
const destinationPath = await mkdtemp(join(tmpdir(), 'tracelo-task-verification-'));
const destination = new DiskAdapter(destinationPath);
const store = new ArchiveStore(destination, directory, '.plugin/backups', 'rules');
await store.initialize();
const result = await importBundle(destination, store, bundle, [], { version: 1, groups: [], events: [] }, createDefaultState());
assert.equal(result.imported, tasks.length);
assert.equal(result.skipped, 0);
const reloaded = await store.loadTasksSafe();
assert.deepEqual(reloaded.errors, []);
assert.equal(reloaded.tasks.length, tasks.length);
for (const original of tasks) assert.deepEqual(reloaded.tasks.find(task => task.id === original.id), original);
assert.deepEqual(result.groups, groups);
let materialCount = 0;
for (const entry of bundle.materials.filter(entry => entry.type === 'file')) {
  const task = result.tasks.find(task => task.id === entry.taskId);
  const actual = Buffer.from(await destination.readBinary(task.materialFolder + '/' + entry.path));
  assert.deepEqual(actual, Buffer.from(entry.data, 'base64'));
  materialCount++;
}
const duplicate = await importBundle(destination, store, bundle, result.tasks, result.groups, result.state);
assert.equal(duplicate.imported, 0);
assert.equal(duplicate.skipped, tasks.length);
assert.deepEqual((await exportBundle(destination, duplicate.tasks, duplicate.groups, duplicate.state, directory)).materials, bundle.materials);
assert.deepEqual(await snapshot(), before, 'Source files changed during verification');
console.log(JSON.stringify({ tasks: tasks.length, materials: materialCount, strictParsing: true, roundtripAndReload: true, repeatedImportSkipped: duplicate.skipped, sourceFilesUnchanged: Object.keys(before).length, destination: destinationPath }, null, 2));
