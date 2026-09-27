import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSendReceipt } from '../client/src/pages/ChecklistPage/checklist-utils.ts';

test('reads conversation and message from an actual successful send receipt', () => {
  assert.deepEqual(parseSendReceipt('checklist', { sendCardInfo: [
    { status: 0, openChatId: 'oc_example', openMessageId: 'om_example' },
  ] }), { checklistId: 'checklist', openChatId: 'oc_example', openMessageId: 'om_example' });
});

test('does not bind cancelled, failed, malformed or multiple sends', () => {
  for (const result of [{}, { sendCardInfo: [] }, { sendCardInfo: [{ status: 1 }] },
    { sendCardInfo: [{ status: 0, openChatId: 123, openMessageId: 'om_example' }] },
    { sendCardInfo: [{}, {}] }]) {
    assert.throws(() => parseSendReceipt('checklist', result));
  }
});
