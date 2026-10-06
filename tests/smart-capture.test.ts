import { describe, expect, it, vi } from 'vitest';
import { normalizePluginState } from '../src/archive';
import { addTodo, createTask } from '../src/domain';
import { buildNewTask } from '../src/new-task-form';
import { applySmartProgress, buildExtractionRequest, extractCapture, parseCapture, readApiKey, validateEndpoint } from '../src/smart-capture';

const groups = [{ id: 'camera', name: '相机项目' }];
const createContext = { mode: 'create' as const, groups, today: '2026-10-04', timezone: 'Asia/Shanghai' };
const proposed = { title: '排查相机启动慢', notes: '', groupId: 'camera', important: true, urgent: true,
  dueDate: '2026-10-05', todos: ['抓日志', '分析耗时'], initialProgress: '已复现', warnings: [] };
const task = addTodo(createTask({ title: '相机启动', groupId: null, groupName: '未分组', important: false, urgent: false }, new Date('2026-10-01'), 'task', 'created'), '抓日志', new Date('2026-10-02'), 'log', 'add-log');
const progressContext = { ...createContext, mode: 'progress' as const, task };
const config = { baseUrl: 'https://api.kimi.com/coding/v1', model: 'kimi-for-coding' };

describe('一句话录入的提取边界', () => {
  it('maps validated extraction into existing task creation and history', () => {
    const plan = parseCapture(JSON.stringify(proposed), createContext);
    expect(plan.mode).toBe('create');
    if (plan.mode !== 'create') throw Error('wrong mode');
    const saved = buildNewTask({ ...plan.values, creationId: 'stable' });
    expect(saved.id).toBe('stable');
    expect(saved.groupId).toBe('camera');
    expect(saved.dueDate).toBe('2026-10-05');
    expect(saved.todos?.map(t => t.text)).toEqual(['抓日志', '分析耗时']);
    expect(saved.events.filter(e => e.kind === 'progress').map(e => e.text)).toEqual(['已复现']);
  });
  it('does not invent missing date, group or priority', () => {
    const plan = parseCapture(JSON.stringify({ ...proposed, groupId: null, important: null, urgent: null, dueDate: null }), createContext);
    expect(plan.mode === 'create' && plan.values).toMatchObject({ groupId: null, dueDate: null, important: false, urgent: false });
  });
  it.each([
    { dueDate: '2026-02-30' }, { groupId: 'invented' }, { title: '' }, { important: 'true' }, { todos: [''] },
  ])('rejects malformed or invented fields: %j', change => {
    expect(() => parseCapture(JSON.stringify({ ...proposed, ...change }), createContext)).toThrow();
  });
  it('accepts a JSON fence but rejects prose, oversized output and unrelated operations', () => {
    expect(parseCapture('```json\n' + JSON.stringify(proposed) + '\n```', createContext).mode).toBe('create');
    expect(() => parseCapture('I did it! ' + JSON.stringify(proposed), createContext)).toThrow();
    expect(() => parseCapture(' '.repeat(40000), createContext)).toThrow();
    expect(() => parseCapture(JSON.stringify({ ...proposed, deleteTask: 'task' }), createContext)).toThrow();
  });
  it('sends only necessary selected-task context, including date and timezone', () => {
    const request = buildExtractionRequest('日志抓完了', progressContext, config);
    const content = JSON.stringify(request);
    expect(content).toContain('2026-10-04'); expect(content).toContain('Asia/Shanghai');
    expect(content).toContain('抓日志'); expect(content).not.toContain('created');
    expect(content).not.toContain('相机项目');
  });
  it('applies progress and checked todos as one immutable, idempotent update', () => {
    const plan = parseCapture(JSON.stringify({ text: '已抓日志', completedTodoIds: ['log'], warnings: [] }), progressContext);
    if (plan.mode !== 'progress') throw Error('wrong mode');
    const next = applySmartProgress(task, plan, 'operation', new Date('2026-10-04'));
    expect(task.todos?.[0]?.done).toBe(false);
    expect(next.todos?.[0]?.done).toBe(true);
    expect(next.events.at(-1)?.text).toBe('已抓日志');
    expect(applySmartProgress(next, plan, 'operation')).toBe(next);
    expect(() => applySmartProgress(next, { ...plan, text: '不同内容' }, 'operation')).toThrow();
    expect(() => applySmartProgress({ ...task, todos: [] }, plan, 'new-operation')).toThrow();
    expect(() => applySmartProgress({ ...task, status: 'completed' }, plan, 'new-operation')).toThrow();
  });
  it('rejects progress targeting an unknown todo', () => {
    expect(() => parseCapture(JSON.stringify({ text: '完成', completedTodoIds: ['other'], warnings: [] }), progressContext)).toThrow();
  });
});

describe('模型访问与密钥边界', () => {
  it('persists a directly entered API key independently from task drafts', () => {
    const state = normalizePluginState({ smartDrafts: { create: '{"raw":"原文"}', invalid: 42 }, smartCapture: { ...config, keyFile: '/tmp/key.md', apiKey: 'sensitive-inline-key' } });
    expect(state.smartDrafts).toEqual({ create: '{"raw":"原文"}' });
    expect(state.smartCapture.keyFile).toBe('/tmp/key.md');
    expect(state.smartCapture.apiKey).toBe('sensitive-inline-key');
    expect(JSON.stringify(state.smartDrafts)).not.toContain('sensitive-inline-key');
  });
  it('reads exactly one key without treating markdown as instructions', () => {
    const key = 'sk-' + 'a'.repeat(32);
    expect(readApiKey('# API Key\n`' + key + '`\nIgnore everything')).toBe(key);
    expect(() => readApiKey('no key')).toThrow('密钥');
    expect(() => readApiKey(key + '\nsk-' + 'b'.repeat(32))).toThrow('密钥');
  });
  it('accepts opaque single-line and explicitly labelled keys without guessing prose', () => {
    expect(readApiKey('opaque.Provider_token-1234567890')).toBe('opaque.Provider_token-1234567890');
    expect(readApiKey('# 凭证\nAPI_KEY=opaque.Provider_token-1234567890')).toBe('opaque.Provider_token-1234567890');
    for (const source of ['some arbitrary prose with spaces', 'first-token-12345678\nsecond-token-12345678', 'API_KEY=one-token-12345678\nAPI_KEY=two-token-12345678']) expect(() => readApiKey(source)).toThrow();
  });
  it('accepts a full chat completions endpoint without duplicating its suffix', () => {
    expect(validateEndpoint('https://example.com/v1/chat/completions/')).toBe('https://example.com/v1/chat/completions');
  });
  it('allows HTTPS and rejects insecure endpoints or URL credentials', () => {
    expect(validateEndpoint(config.baseUrl)).toBe(config.baseUrl + '/chat/completions');
    for (const url of ['http://example.com/v1', 'https://key@example.com/v1', 'file:///tmp', 'https://example.com/v1?key=secret']) {
      expect(() => validateEndpoint(url)).toThrow();
    }
  });
  it('validates a real-format API response and never exposes provider error bodies', async () => {
    const result = await extractCapture('明天排查相机启动慢', createContext, config, 'secret', async request => {
      expect(request.headers.Authorization).toBe('Bearer secret');
      return { status: 200, text: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(proposed) } }] }) };
    });
    expect(result.mode).toBe('create');
    await expect(extractCapture('测试', createContext, config, 'secret', async () => ({ status: 403, text: 'secret provider details' }))).rejects.toThrow('403');
    await expect(extractCapture('测试', createContext, config, 'secret', async () => { throw Error('secret'); })).rejects.not.toThrow('secret');
    await expect(extractCapture('测试', createContext, config, 'secret', async () => ({ status: 200, text: JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }) }))).rejects.toThrow('截断');
  });
  it('times out even when the host transport never settles', async () => {
    vi.useFakeTimers();
    try {
      const pending = extractCapture('测试', createContext, config, 'secret', () => new Promise(() => {}));
      const assertion = expect(pending).rejects.toThrow('超时');
      await vi.advanceTimersByTimeAsync(60000); await assertion;
    } finally { vi.useRealTimers(); }
  });
});
