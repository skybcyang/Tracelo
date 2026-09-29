import { describe, it, expect } from 'vitest';
import { decodeQuickImages, applyQuickOperation, type QuickOperation } from '../src/quick-operations';
import { createTask } from '../src/domain';
describe('durable progress images', () => {
  it('verifies bytes before storage and keeps binary payloads out of event metadata', async () => {
    const base64 = 'aGVsbG8=';
    const sha256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
    const task = createTask({title:'图文进展',groupId:null,groupName:'未分组',important:false,urgent:false},new Date(),'task','created');
    const op: QuickOperation = { version:1,id:'quick-image',taskId:'task',kind:'progress',text:'截图\n![结果](<image-demo.png>)',attachments:[{name:'image-demo.png',base64,sha256}] };
    expect((await decodeQuickImages(op))[0]?.bytes.length).toBe(5);
    const next = applyQuickOperation(task,op,[]);
    expect(next.events.at(-1)?.meta?.quickOperation).not.toContain(base64);
    expect(applyQuickOperation(next,op,[])).toBe(next);
    await expect(decodeQuickImages({...op,attachments:[{name:'image-demo.png',base64:'aGk=',sha256}]})).rejects.toThrow('校验');
    await expect(decodeQuickImages({...op,attachments:[{name:'../image.png',base64,sha256}]})).rejects.toThrow('图片');
  });
});
