import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  decryptPayload,
  parseCallback,
  processCallback,
  renderCard,
  verifySignature,
  parseIncomingCallback,
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

test('answers a signed URL verification challenge', () => {
  const body = JSON.stringify({ type: 'url_verification', token: 'token', challenge: 'challenge-1' });
  const key = 'encrypt-key';
  const signature = crypto.createHash('sha256').update('123nonce' + key + body).digest('hex');
  assert.deepEqual(parseIncomingCallback(Buffer.from(body), {
    'x-lark-request-timestamp': '123', 'x-lark-request-nonce': 'nonce',
    'x-lark-signature': signature,
  }, { appId: 'cli_test', verificationToken: 'token', encryptKey: key }),
  { challenge: 'challenge-1' });
});

test('rejects unsigned or altered callbacks before processing them', () => {
  const config = { appId: 'cli_test', verificationToken: 'token', encryptKey: 'key' };
  assert.throws(() => parseIncomingCallback(Buffer.from(JSON.stringify(payload())), {}, config), /签名/);
  assert.throws(() => parseIncomingCallback(Buffer.from(JSON.stringify(payload())), {
    'x-lark-request-timestamp': '123', 'x-lark-request-nonce': 'nonce',
    'x-lark-signature': 'invalid',
  }, config), /签名/);
  assert.throws(() => parseIncomingCallback(Buffer.from('{}'), {}, {
    appId: '', verificationToken: '', encryptKey: '',
  }), /配置/);
});

test('accepts Feishu URL verification without signature headers only with its token', () => {
  const config = { appId: 'cli_test', verificationToken: 'token', encryptKey: 'key' };
  const challenge = { type: 'url_verification', token: 'token', challenge: 'check-me' };
  assert.deepEqual(parseIncomingCallback(Buffer.from(JSON.stringify(challenge)), {}, config),
    { challenge: 'check-me' });
  assert.throws(() => parseIncomingCallback(Buffer.from(JSON.stringify({
    ...challenge, token: 'wrong',
  })), {}, config), /Token|校验/);

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', crypto.createHash('sha256')
    .update(config.encryptKey).digest(), iv);
  const encrypt = Buffer.concat([iv, cipher.update(JSON.stringify(challenge)),
    cipher.final()]).toString('base64');
  assert.deepEqual(parseIncomingCallback(Buffer.from(JSON.stringify({ encrypt })), {}, config),
    { challenge: 'check-me' });
  assert.throws(() => parseIncomingCallback(Buffer.from(JSON.stringify({ encrypt })), {
    'x-lark-request-timestamp': '123',
  }, config), /签名/);
});
