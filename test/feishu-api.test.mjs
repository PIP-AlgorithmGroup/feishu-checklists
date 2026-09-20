import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createJsapiSignature,
  parseMiaodaFileReference,
  parseMiaodaOrigin,
  validateImageBytes,
  validateVideoBytes,
} from '../server/modules/checklist/feishu-utils.ts';

test('creates the documented Feishu JSAPI SHA-1 signature', () => {
  assert.equal(
    createJsapiSignature({
      ticket: 'ticket',
      nonceStr: 'nonce',
      timestamp: 1_700_000_000_000,
      url: 'https://example.com/page?a=1',
    }),
    '6e9a8b65e5e5175d5b2ba08745a716b6a3466eef',
  );
});

test('allows only a fixed Miaoda production origin', () => {
  assert.equal(parseMiaodaOrigin('https://mcns8dt9m0cm.feishuapp.com'), 'https://mcns8dt9m0cm.feishuapp.com');
  assert.throws(() => parseMiaodaOrigin('http://127.0.0.1'), /妙搭线上地址无效/);
  assert.throws(() => parseMiaodaOrigin('https://example.com'), /妙搭线上地址无效/);
});

test('accepts only this Miaoda app storage route', () => {
  assert.deepEqual(
    parseMiaodaFileReference(
      '/app/app_17eebbe30dh/runtime/api/v1/storage/object/bucket-1/folder%2Fphoto.png',
      'app_17eebbe30dh',
    ),
    { bucketId: 'bucket-1', filePath: 'folder/photo.png' },
  );
  assert.throws(
    () => parseMiaodaFileReference('https://attacker.example/file', 'app_17eebbe30dh'),
    /妙搭文件地址无效/,
  );
  assert.throws(
    () => parseMiaodaFileReference(
      '/app/app_other/runtime/api/v1/storage/object/bucket-1/file.png',
      'app_17eebbe30dh',
    ),
    /妙搭文件地址无效/,
  );
});

test('validates image and MP4 signatures and limits', () => {
  assert.equal(validateImageBytes(Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg'), 'jpg');
  assert.throws(
    () => validateImageBytes(Buffer.from('not-an-image'), 'image/png'),
    /文件内容与图片类型不匹配/,
  );
  const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.alloc(4)]);
  validateVideoBytes(mp4, 'video/mp4');
  assert.throws(() => validateVideoBytes(Buffer.alloc(12), 'video/mp4'), /文件内容与 MP4 格式不匹配/);
});
