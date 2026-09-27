import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PgDialect } from 'drizzle-orm/pg-core';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../server/modules/checklist/checklist.service.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
}).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)((id) => {
  if (id === '../../database/schema') return { checklist: {
    createdBy: 'owner', title: 'title', updatedAt: 'updated', id: 'id', openChatId: 'chat',
    items: 'items', conversationName: 'conversation_name',
  } };
  if (id === './checklist') return { parseStoredChecklist: (record) => record };
  return require(id);
}, module, module.exports);
const { ChecklistService } = module.exports;

test('management listing scopes both queries to owner and returns progress with timestamps', async () => {
  const conditions = [];
  const rows = [{ checklistKey: 'mine', title: 'Inspection', items: [{ id: 'i', checked: true }],
    createdAt: new Date('2026-09-01'), updatedAt: new Date('2026-09-02'), openMessageId: 'message',
    openChatId: 'oc_example', conversationName: '私聊联系人' }];
  const db = { select: (fields) => ({ from: () => ({ where: (condition) => {
    conditions.push(condition);
    if (fields) return Promise.resolve([{ total: 1 }]);
    return { orderBy: () => ({ limit: () => ({ offset: async () => rows }) }) };
  } }) }) };
  const result = await new ChecklistService(db).list('current-user', 1, 'Inspection');
  assert.deepEqual(result, { items: [{ id: 'mine', title: 'Inspection', items: rows[0].items,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z',
    boundToMessage: true, conversation: { chatId: 'oc_example', name: '私聊联系人',
      url: 'https://applink.feishu.cn/client/chat/open?openChatId=oc_example' } }],
    total: 1, page: 1, pageSize: 20 });
  assert.equal(conditions.length, 2);
  assert.match(JSON.stringify(conditions), /current-user/);
});

test('management listing refuses an absent identity before querying', async () => {
  await assert.rejects(new ChecklistService({}).list('', 1, ''), /请先登录/);
});

const binding = { checklistId: 'mine', openChatId: 'oc_example', openMessageId: 'om_example' };
function bindingDatabase(row, onUpdate = () => {}) {
  return {
    select: () => ({ from: () => ({ where: async () => row ? [row] : [] }) }),
    update: () => ({ set: (values) => {
      onUpdate(values);
      return { where: () => ({ returning: async () => [{ id: 'row' }] }) };
    } }),
  };
}

test('persists the send receipt immediately and advances callback concurrency version', async () => {
  let saved;
  await new ChecklistService(bindingDatabase({ id: 'row', createdBy: 'owner', version: 2 },
    (values) => { saved = values; })).bindMessage(binding, 'owner');
  assert.equal(saved.openChatId, 'oc_example');
  assert.equal(saved.openMessageId, 'om_example');
  assert.equal(saved.version, 3);
});

test('rejects another owner and conflicting conversation or message', async () => {
  for (const row of [{ createdBy: 'other' }, { createdBy: 'owner', openChatId: 'oc_other' },
    { createdBy: 'owner', openMessageId: 'om_other' }]) {
    await assert.rejects(new ChecklistService(bindingDatabase(row)).bindMessage(binding, 'owner'));
  }
});

test('a repeated receipt after binding or a checkbox callback is idempotent', async () => {
  const row = { createdBy: 'owner', openChatId: binding.openChatId, openMessageId: binding.openMessageId };
  await new ChecklistService(bindingDatabase(row, () => assert.fail('must not update')))
    .bindMessage(binding, 'owner');
});

test('message binding rejects missing identity and an absent checklist', async () => {
  await assert.rejects(new ChecklistService({}).bindMessage(binding, ''), /请先登录/);
  await assert.rejects(new ChecklistService(bindingDatabase(null)).bindMessage(binding, 'owner'), /清单不存在/);
});

test('a callback winning the version race does not overwrite its item changes', async () => {
  let reads = 0;
  const db = {
    select: () => ({ from: () => ({ where: async () => ++reads === 1
      ? [{ id: 'row', createdBy: 'owner', version: 1 }]
      : [{ id: 'row', createdBy: 'owner', version: 2, ...binding }] }) }),
    update: () => ({ set: (values) => {
      assert.equal('items' in values, false);
      return { where: () => ({ returning: async () => [] }) };
    } }),
  };
  await new ChecklistService(db).bindMessage(binding, 'owner');
  assert.equal(reads, 2);
});

test('saves a private chat name only on the current owners checklists for that chat', async () => {
  let saved;
  let condition;
  const db = { update: () => ({ set: (values) => {
    saved = values;
    return { where: (value) => {
      condition = value;
      return { returning: async () => [{ id: 'row' }] };
    } };
  } }) };
  await new ChecklistService(db).saveConversationName({ chatId: 'oc_peer', name: '张三' }, 'owner-id');
  assert.deepEqual(saved, { conversationName: '张三' });
  assert.match(JSON.stringify(condition), /owner-id/);
  assert.match(JSON.stringify(condition), /oc_peer/);
});

test('refuses to save a name if the user owns no checklist in that conversation', async () => {
  const db = { update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }) };
  await assert.rejects(new ChecklistService(db).saveConversationName({ chatId: 'oc_peer', name: '张三' }, 'owner'),
    /没有属于你的清单/);
});

test('administrator query returns checklists from different creators', async () => {
  const rows = ['first-owner', 'second-owner'].map((createdBy) => ({
    checklistKey: createdBy, createdBy, title: '检查', items: [],
    createdAt: new Date('2026-09-01'), updatedAt: new Date('2026-09-01'),
  }));
  const conditions = [];
  const db = { select: (fields) => ({ from: () => ({ where: (condition) => {
    conditions.push(condition);
    return fields ? [{ total: 2 }] : { orderBy: () => ({ limit: () => ({ offset: async () => rows }) }) };
  } }) }) };
  const result = await new ChecklistService(db).listAdmin({ page: 1, search: '', creatorId: '',
    conversation: '', status: 'all' });
  assert.deepEqual(result.items.map((record) => record.createdBy), ['first-owner', 'second-owner']);
  assert.equal(conditions.every((condition) => condition === undefined), true);
});

test('administrator filters use bound parameters and completion predicates in both queries', async () => {
  const queries = [];
  const db = { select: (fields) => ({ from: () => ({ where: (condition) => {
    queries.push(new PgDialect().sqlToQuery(condition));
    return fields ? [{ total: 0 }] : { orderBy: () => ({ limit: () => ({ offset: async () => [] }) }) };
  } }) }) };
  await new ChecklistService(db).listAdmin({ page: 2, search: 'check_%', creatorId: 'owner-id',
    conversation: 'peer', status: 'completed' });
  assert.equal(queries.length, 2);
  assert.equal(queries.every((query) => query.sql.includes('jsonb_array_elements')), true);
  assert.equal(queries.every((query) => query.params.includes('owner-id')), true);
  assert.equal(queries.every((query) => query.params.includes('%check\\_\\%%')), true);
  assert.equal(queries.every((query) => !query.sql.includes('owner-id')), true);
});

function imageDatabase(owner, imageKey = 'img_allowed') {
  return { select: () => ({ from: () => ({ where: async () => [{
    checklistKey: 'mine', createdBy: owner, title: '检查',
    createdAt: new Date(), updatedAt: new Date(),
    items: [{ id: 'item', images: [{ imageKey }] }],
  }] }) }) };
}

test('image access permits the owner and only images present in the checklist', async () => {
  const service = new ChecklistService(imageDatabase('owner'));
  await service.requireImage('mine', 'img_allowed', 'owner');
  await assert.rejects(service.requireImage('mine', 'img_unrelated', 'owner'), /图片不存在/);
});

test('image access rejects another owner and an absent identity', async () => {
  const service = new ChecklistService(imageDatabase('owner'));
  await assert.rejects(service.requireImage('mine', 'img_allowed', 'other'), /图片不存在/);
  await assert.rejects(service.requireImage('mine', 'img_allowed', ''), /请先登录/);
});

test('administrator image retrieval still requires checklist membership', async () => {
  const service = new ChecklistService(imageDatabase('other'));
  await service.requireImage('mine', 'img_allowed');
  await assert.rejects(service.requireImage('mine', 'img_unrelated'), /图片不存在/);
});
