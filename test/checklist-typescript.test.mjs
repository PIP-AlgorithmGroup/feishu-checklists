import test from 'node:test';
import assert from 'node:assert/strict';

import { matchesChecklistDraft, parseChecklist } from '../server/modules/checklist/checklist.ts';

const input = () => ({
  id: 'checklist-1',
  title: '门店检查',
  items: [{
    id: 'item-1',
    text: '检查门头',
    checked: true,
    images: [{ fileId: '/media/photo.png', imageKey: 'img_v3_photo' }],
    videos: [{ fileId: '/media/video.mp4', fileKey: 'file_v3_video' }],
  }],
});

test('normalizes a checklist and resets submitted check state', () => {
  const checklist = parseChecklist(input());
  assert.deepEqual(checklist.items[0], {
    id: 'item-1',
    text: '检查门头',
    checked: false,
    images: [{ fileId: '/media/photo.png', imageKey: 'img_v3_photo', width: null, height: null, size: null }],
    videos: [{ fileId: '/media/video.mp4', fileKey: 'file_v3_video', fileName: 'video.mp4', duration: null }],
  });
});

test('rejects duplicate item IDs and excessive media', () => {
  assert.throws(() => parseChecklist({ ...input(), items: [input().items[0], input().items[0]] }), /事项标识重复/);
  const bad = input();
  bad.items[0].images = Array.from({ length: 4 }, () => ({ imageKey: 'img' }));
  assert.throws(() => parseChecklist(bad), /最多添加 3 张图片/);
});

test('rejects missing or malformed fields', () => {
  assert.throws(() => parseChecklist({ ...input(), items: [] }), /1-50/);
  assert.throws(() => parseChecklist({ ...input(), title: ' '.repeat(3) }), /1-80/);
  const bad = input();
  bad.items[0].images = [{ fileId: 'unregistered' }];
  assert.throws(() => parseChecklist(bad), /图片标识无效/);
});

test('recognizes an unchanged retry after jsonb reorders object keys', () => {
  const draft = parseChecklist(input());
  const stored = {
    title: draft.title,
    items: [{
      videos: draft.items[0].videos,
      images: draft.items[0].images,
      checked: false,
      text: draft.items[0].text,
      id: draft.items[0].id,
    }],
  };
  assert.equal(matchesChecklistDraft(stored, draft), true);
  stored.items[0].checked = true;
  assert.equal(matchesChecklistDraft(stored, draft), true);
  assert.equal(matchesChecklistDraft({ ...stored, title: 'Another title' }, draft), false);
});
