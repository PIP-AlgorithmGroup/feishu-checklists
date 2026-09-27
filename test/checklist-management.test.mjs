import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../server/modules/checklist/checklist.service.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
}).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)((id) => {
  if (id === '../../database/schema') return { checklist: {
    createdBy: 'owner', title: 'title', updatedAt: 'updated', id: 'id',
  } };
  if (id === './checklist') return { parseStoredChecklist: (record) => record };
  return require(id);
}, module, module.exports);
const { ChecklistService } = module.exports;

test('management listing scopes both queries to owner and returns progress with timestamps', async () => {
  const conditions = [];
  const rows = [{ checklistKey: 'mine', title: 'Inspection', items: [{ id: 'i', checked: true }],
    createdAt: new Date('2026-09-01'), updatedAt: new Date('2026-09-02'), openMessageId: 'message',
    openChatId: 'oc_example' }];
  const db = { select: (fields) => ({ from: () => ({ where: (condition) => {
    conditions.push(condition);
    if (fields) return Promise.resolve([{ total: 1 }]);
    return { orderBy: () => ({ limit: () => ({ offset: async () => rows }) }) };
  } }) }) };
  const result = await new ChecklistService(db).list('current-user', 1, 'Inspection');
  assert.deepEqual(result, { items: [{ id: 'mine', title: 'Inspection', items: rows[0].items,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z',
    boundToMessage: true, conversation: { chatId: 'oc_example', name: null,
      url: 'https://applink.feishu.cn/client/chat/open?openChatId=oc_example' } }],
    total: 1, page: 1, pageSize: 20 });
  assert.equal(conditions.length, 2);
  assert.match(JSON.stringify(conditions), /current-user/);
});

test('management listing refuses an absent identity before querying', async () => {
  await assert.rejects(new ChecklistService({}).list('', 1, ''), /请先登录/);
});
