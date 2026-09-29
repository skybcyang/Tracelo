// Generates an isolated vault for manual native QA; never changes the user's vault.
import { mkdtemp, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
const compiled = await build({ stdin: { contents: "export {buildNewTask} from './src/new-task-form'; export {serializeTaskMarkdown,createDefaultState} from './src/archive';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm' });
const { buildNewTask, serializeTaskMarkdown, createDefaultState } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const root = await mkdtemp(join(tmpdir(), 'tracelo-native-qa-'));
const plugin = join(root, '.obsidian/plugins/work-timeline');
await mkdir(plugin, { recursive: true });
await mkdir(join(root, 'tasks'));
for (const file of ['main.js', 'styles.css', 'manifest.json']) await copyFile(file, join(plugin, file));
await writeFile(join(root, '.obsidian/community-plugins.json'), JSON.stringify(['work-timeline']));
await writeFile(join(root, '.obsidian/app.json'), JSON.stringify({ attachmentFolderPath: './' }));
await writeFile(join(plugin, 'data.json'), JSON.stringify({ ...createDefaultState(), taskDirectory: 'tasks' }));
for (let index = 1; index <= 3; index++) {
  const task = buildNewTask({ title: `实机验收任务 ${index}`, groupId: null, groupName: '未分组', important: true, urgent: index === 1, notes: '**实机验收**：检查图文草稿、日历和快捷进展。', initialProgress: '基线进展，需要保留', todos: ['检查图片', '检查追加历史'], dueDate: '2026-09-29' });
  await writeFile(join(root, 'tasks', task.id + '.md'), serializeTaskMarkdown(task));
}
await writeFile(join(root, 'README.md'), '# Tracelo 独立实机验收\n\n此仓库仅含生成的测试任务，可保留作为验收证据。\n');
await copyFile('docs/validation/task-implementation/calendar-light.png', join(root, '验收截图.png'));
console.log(root);
