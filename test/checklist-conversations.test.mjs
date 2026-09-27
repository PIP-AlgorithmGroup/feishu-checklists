import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(
  new URL('../server/modules/checklist/feishu-api.ts', import.meta.url), 'utf8',
), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true,
} }).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  (id) => id === './feishu-utils' ? {} : require(id), module, module.exports,
);
const { FeishuApiService } = module.exports;

test('resolves each distinct conversation once and reuses cached names', async (t) => {
  const previousId = process.env.FEISHU_APP_ID;
  const previousSecret = process.env.FEISHU_APP_SECRET;
  process.env.FEISHU_APP_ID = 'test-app';
  process.env.FEISHU_APP_SECRET = 'test-secret';
  t.after(() => {
    if (previousId === undefined) delete process.env.FEISHU_APP_ID;
    else process.env.FEISHU_APP_ID = previousId;
    if (previousSecret === undefined) delete process.env.FEISHU_APP_SECRET;
    else process.env.FEISHU_APP_SECRET = previousSecret;
  });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    return Response.json(String(url).includes('/auth/')
      ? { code: 0, tenant_access_token: 'test-token', expire: 7200 }
      : { code: 0, data: { name: '门店巡检群' } });
  });
  const service = new FeishuApiService();
  const result = await service.getChatNames(['oc_store', 'oc_store']);
  assert.equal(result.get('oc_store'), '门店巡检群');
  await service.getChatNames(['oc_store']);
  assert.equal(calls.filter((url) => url.includes('/chats/')).length, 1);
});

test('an inaccessible chat keeps a null name and does not fail the list', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 232002, msg: 'No permission' }));
  const service = new FeishuApiService();
  t.mock.method(service.logger, 'warn', () => {});
  const result = await service.getChatNames(['oc_inaccessible']);
  assert.equal(result.get('oc_inaccessible'), null);
  assert.equal(service.logger.warn.mock.callCount(), 1);
});

test('unbound checklists do not call the Feishu API', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected request'); });
  assert.equal((await new FeishuApiService().getChatNames([])).size, 0);
  assert.equal(fetchMock.mock.callCount(), 0);
});
