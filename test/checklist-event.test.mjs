import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseStoredChecklist,
  updateChecklistItem,
} from '../server/modules/checklist/checklist.ts';

const stored = () => ({
  id: 'list-1',
  title: 'Store audit',
  items: [
    { id: 'first', text: 'First', checked: false, images: [], videos: [] },
    { id: 'second', text: 'Second', checked: true, images: [], videos: [] },
  ],
});

test('updates only the targeted checker while preserving persisted state', () => {
  const draft = parseStoredChecklist(stored());
  const changed = updateChecklistItem(draft, 'first', true);
  assert.deepEqual(changed.items.map((item) => item.checked), [true, true]);
  assert.deepEqual(draft.items.map((item) => item.checked), [false, true]);
});

test('rejects unknown items and malformed stored check state', () => {
  assert.throws(() => updateChecklistItem(parseStoredChecklist(stored()), 'missing', true), /事项不存在/);
  const row = stored();
  row.items[0].checked = 'true';
  assert.throws(() => parseStoredChecklist(row), /勾选状态无效/);
});
