import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  decryptPayload,
  parseCallback,
  processCallback,
  renderCard,
  verifySignature,
} from '../server/modules/checklist/callback.ts';

const payload = () => ({
  schema: '2.0',
  header: {
    event_id: 'event-1', event_type: 'card.action.trigger',
    app_id: 'cli_test', token: 'token',
  },
  event: {
    action: {
      tag: 'checker', checked: true,
      value: { checklist_id: 'list-1', item_id: 'item-1' },
    },
    context: { open_message_id: 'om_1', open_chat_id: 'oc_1' },
  },
});

test('validates the checker and its Feishu app identity', () => {
  assert.deepEqual(parseCallback(payload(), { appId: 'cli_test', verificationToken: 'token' }), {
    eventId: 'event-1', checklistId: 'list-1', itemId: 'item-1',
    checked: true, openMessageId: 'om_1', openChatId: 'oc_1',
  });
  assert.throws(() => parseCallback(payload(), { appId: 'cli_other' }), /App ID/);
  const wrong = payload();
  wrong.event.action.checked = 'true';
  assert.throws(() => parseCallback(wrong, {}), /checker/);
});

test('responds with the persisted card and duplicate toast', async () => {
  const checklist = {
    id: 'list-1', title: 'Audit',
    items: [{ id: 'item-1', text: 'Check', checked: true, images: [], videos: [] }],
  };
  const response = await processCallback(payload(), {
    async apply(event) {
      assert.equal(event.openChatId, 'oc_1');
      return { duplicate: true, checklist };
    },
  }, { appId: 'cli_test', verificationToken: 'token' });
  assert.equal(response.toast.content, '状态已是最新');
  assert.equal(response.card.data.body.elements[1].checked, true);
  assert.equal(renderCard(checklist).body.elements[0].content, '**进度：1/1**');
});

test('verifies raw signatures and decrypts encrypted payloads', () => {
  const body = JSON.stringify(payload());
  const key = 'encrypt-key';
  const signature = crypto.createHash('sha256').update('123nonce' + key + body).digest('hex');
  assert.equal(verifySignature({ timestamp: '123', nonce: 'nonce', encryptKey: key, body, signature }), true);
  assert.equal(verifySignature({ timestamp: '123', nonce: 'nonce', encryptKey: key, body, signature: 'bad' }), false);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', crypto.createHash('sha256').update(key).digest(), iv);
  const encrypted = Buffer.concat([iv, cipher.update(body), cipher.final()]).toString('base64');
  assert.deepEqual(decryptPayload(encrypted, key), payload());
});
