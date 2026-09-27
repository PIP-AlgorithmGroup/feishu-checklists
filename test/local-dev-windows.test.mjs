import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createLocalDevEnvironment, startLocalDev } = require('../scripts/dev-windows.cjs');

test('Windows startup enables the platform proxy and preserves the pulled identity', () => {
  const pulled = { SUDA_WEBUSER: '{\\"user_id\\":\\"developer\\",\\"app_id\\":\\"app-test\\"}',
    MIAODA_DEV_PLATFORM_BASE: 'https://platform.example', FORCE_AUTHN_PREVIEW_SESSION_ID: 'session' };
  const env = createLocalDevEnvironment({}, pulled, {});
  assert.equal(env.MIAODA_LOCAL_DEV, '1');
  assert.equal(env.NODE_ENV, 'development');
  assert.equal(env.MIAODA_APP_TYPE, '3');
  assert.equal(env.CLIENT_DEV_HOST, '127.0.0.1');
  assert.equal(JSON.parse(env.SUDA_WEBUSER).user_id, 'developer');
  assert.equal(env.FORCE_AUTHN_PREVIEW_SESSION_ID, 'session');
});

test('Windows startup uses Node entry points for both servers without a command shell', () => {
  const calls = [];
  startLocalDev({ MIAODA_LOCAL_DEV: '1' }, (executable, args, options) => {
    calls.push({ executable, args, options });
    return { on() {} };
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].executable, process.execPath);
  assert.match(calls[0].args[0], /nest\.js$/);
  assert.match(calls[1].args[0], /vite\.js$/);
  assert.equal(calls[1].options.env.MIAODA_LOCAL_DEV, '1');
  assert.equal(calls[1].options.shell, false);
});

test('Windows startup respects existing shell credentials and rejects malformed user data', () => {
  const env = createLocalDevEnvironment({ FORCE_AUTHN_PREVIEW_SESSION_ID: 'shell-session' },
    { FORCE_AUTHN_PREVIEW_SESSION_ID: 'file-session', SUDA_WEBUSER: '{"user_id":"developer"}' }, {});
  assert.equal(env.FORCE_AUTHN_PREVIEW_SESSION_ID, 'shell-session');
  assert.throws(() => createLocalDevEnvironment({}, { SUDA_WEBUSER: 'invalid' }, {}), /SUDA_WEBUSER/);
});
