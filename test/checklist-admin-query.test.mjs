import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAdminQuery } from '../server/modules/checklist/admin-query.ts';

test('admin filters have safe defaults and normalize text', () => {
  assert.deepEqual(parseAdminQuery({ search: ' 检查 ' }), {
    page: 1, search: '检查', creatorId: '', conversation: '', status: 'all',
  });
});

test('admin filters reject invalid pages, unknown status and array query values', () => {
  for (const query of [{ page: '0' }, { page: '1.5' }, { page: 'Infinity' },
    { status: 'unchecked' }, { creatorId: ['123'] }, { conversation: 'a'.repeat(201) },
    { search: 'a'.repeat(81) }, { page: ['1'] }]) assert.throws(() => parseAdminQuery(query));
});
