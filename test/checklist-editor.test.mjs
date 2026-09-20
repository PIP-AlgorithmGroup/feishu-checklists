import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCardContent,
  getSafeLoginReturnUrl,
  needsMiaodaLogin,
  parseTriggerCode,
} from '../client/src/pages/ChecklistPage/checklist-utils.ts';

test('reads the Feishu launch trigger from the side-panel URL', () => {
  const query = encodeURIComponent(JSON.stringify({ trigger_id: 'trigger-1' }));
  assert.equal(parseTriggerCode(`https://example.com/?bdp_launch_query=${query}`), 'trigger-1');
  assert.equal(parseTriggerCode('https://example.com/'), null);
});

test('detects the auth SDK 401 response even when it reports no error object', () => {
  assert.equal(needsMiaodaLogin(401, undefined), true);
  assert.equal(needsMiaodaLogin(200, undefined), true);
  assert.equal(needsMiaodaLogin(200, 1870298520440907), false);
});

test('removes Feishu launch parameters from the Miaoda login return URL', () => {
  assert.equal(
    getSafeLoginReturnUrl('https://example.com/app/app_1?bdp_launch_query=%7B%7D#from'),
    'https://example.com/app/app_1',
  );
});

test('builds the same interactive media card shape used by callbacks', () => {
  const content = buildCardContent({
    id: 'checklist-1',
    title: '门店检查',
    items: [{
      id: 'item-1', text: '检查门头', checked: false,
      images: [{ fileId: 'file-1', imageKey: 'img-1', width: 100, height: 100, size: 200 }],
      videos: [{ fileId: 'file-2', fileKey: 'video-1', fileName: 'clip.mp4', duration: 8000 }],
    }],
  });
  assert.equal(content.update_multi, true);
  assert.equal(content.card.config.update_multi, true);
  assert.equal(content.card.body.elements[1].tag, 'checker');
  assert.equal(content.card.body.elements[2].img_key, 'img-1');
  assert.equal(content.card.body.elements[3].file_key, 'video-1');
});
