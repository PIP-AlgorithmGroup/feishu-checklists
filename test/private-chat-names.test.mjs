import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const compiled = ts.transpileModule(readFileSync(
  new URL('../client/src/utils/feishu-conversations.ts', import.meta.url), 'utf8',
), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)((id) => {
  if (id === '@lark-apaas/client-toolkit/logger') return { logger: { warn() {} } };
  throw new Error(`Unexpected import ${id}`);
}, module, module.exports);
const { readPrivateChatName, configureConversationReader } = module.exports;

test('reads the peer display name using documented private user chat arguments', async () => {
  const bridge = { getChatInfo(options) {
    assert.equal(options.openChatId, 'oc_peer');
    assert.equal(options.chatType, 0);
    assert.equal(options.userType, 0);
    options.success({ name: ' 张三 ' });
  } };
  assert.equal(await readPrivateChatName(bridge, 'oc_peer'), '张三');
});

test('uses the international name when the main name is empty', async () => {
  assert.equal(await readPrivateChatName({ getChatInfo: (options) =>
    options.success({ name: '', i18nNames: { zh_cn: '李四' } }) }, 'oc_peer'), '李四');
});

test('does not invent names when the client returns no name or denies access', async () => {
  assert.equal(await readPrivateChatName({ getChatInfo: (options) => options.success({}) }, 'oc_peer'), null);
  assert.equal(await readPrivateChatName({ getChatInfo: (options) => options.fail({ errCode: 1 }) }, 'oc_peer'), null);
});

test('configures the name reader with the server supplied signature', async () => {
  const sign = { appId: 'app', nonceStr: 'nonce', timestamp: 1, signature: 'signature' };
  await configureConversationReader({ config(options) {
    assert.equal(options.signature, sign.signature);
    assert.deepEqual(options.jsApiList, ['sendMessageCard', 'getChatInfo']);
    options.onSuccess();
  } }, sign);
});
