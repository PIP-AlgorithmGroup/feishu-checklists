import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as utils from '../server/modules/checklist/feishu-utils.ts';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../server/modules/checklist/feishu-api.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
}).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)((id) =>
  id === './feishu-utils' ? utils : require(id), module, module.exports);
const { FeishuApiService } = module.exports;

function mockDownload(t, response) {
  const originalId = process.env.FEISHU_APP_ID;
  const originalSecret = process.env.FEISHU_APP_SECRET;
  process.env.FEISHU_APP_ID = 'test-app';
  process.env.FEISHU_APP_SECRET = 'test-secret';
  t.after(() => {
    if (originalId === undefined) delete process.env.FEISHU_APP_ID;
    else process.env.FEISHU_APP_ID = originalId;
    if (originalSecret === undefined) delete process.env.FEISHU_APP_SECRET;
    else process.env.FEISHU_APP_SECRET = originalSecret;
  });
  return t.mock.method(globalThis, 'fetch', async (url) => String(url).includes('/auth/')
    ? Response.json({ code: 0, tenant_access_token: 'test-token', expire: 7200 }) : response);
}

test('downloads valid image bytes with server authorization', async (t) => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  const fetchMock = mockDownload(t, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }));
  const image = await new FeishuApiService().downloadImage('img_key');
  assert.deepEqual(image.buffer, bytes);
  assert.equal(image.mimeType, 'image/jpeg');
  assert.equal(fetchMock.mock.calls.at(-1).arguments[1].headers.authorization, 'Bearer test-token');
});

test('rejects a non-image response and a failed Feishu download', async (t) => {
  mockDownload(t, Response.json({ code: 1 }));
  await assert.rejects(new FeishuApiService().downloadImage('img_key'), /无法读取/);
});

test('rejects an oversized download before reading bytes', async (t) => {
  mockDownload(t, new Response('image', { headers: { 'content-length': String(6 * 1024 * 1024) } }));
  await assert.rejects(new FeishuApiService().downloadImage('img_key'), /无法读取/);
});
