import type {
  ChecklistDraft,
  ChecklistImage,
  ChecklistItem,
  ChecklistVideo,
} from '../../../shared/api.interface';
import { isDeepStrictEqual } from 'node:util';

export interface ChecklistEvent {
  eventId: string;
  checklistId: string;
  itemId: string;
  checked: boolean;
  openMessageId: string;
  openChatId: string;
}

export function matchesChecklistDraft(
  stored: { title: string; items: unknown }, draft: ChecklistDraft,
): boolean {
  if (stored.title !== draft.title) return false;
  const current: ChecklistDraft = parseStoredChecklist({
    id: draft.id, title: stored.title, items: stored.items,
  });
  return isDeepStrictEqual(
    current.items.map((item: ChecklistItem) => ({ ...item, checked: false })),
    draft.items,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value: unknown): string | null {
  return text(value) || null;
}

function optionalNumber(value: unknown): number | null {
  const numberValue: number = Number(value);
  return Number.isFinite(numberValue) && numberValue !== 0 ? numberValue : null;
}

function parseImages(value: unknown): ChecklistImage[] {
  const images: unknown[] = Array.isArray(value) ? value : [];
  if (images.length > 3) throw new Error('每个事项最多添加 3 张图片');
  return images.map((image: unknown): ChecklistImage => {
    if (!isRecord(image) || !text(image.imageKey)) {
      throw new Error('事项图片标识无效');
    }
    return {
      fileId: optionalText(image.fileId),
      imageKey: text(image.imageKey),
      width: optionalNumber(image.width),
      height: optionalNumber(image.height),
      size: optionalNumber(image.size),
    };
  });
}

function parseVideos(value: unknown): ChecklistVideo[] {
  const videos: unknown[] = Array.isArray(value) ? value : [];
  if (videos.length > 3) throw new Error('每个事项最多添加 3 个视频');
  return videos.map((video: unknown): ChecklistVideo => {
    if (!isRecord(video) || !text(video.fileKey)) {
      throw new Error('事项视频标识无效');
    }
    return {
      fileId: optionalText(video.fileId),
      fileKey: text(video.fileKey),
      fileName: text(video.fileName) || 'video.mp4',
      duration: optionalNumber(video.duration),
    };
  });
}

export function parseChecklist(input: unknown): ChecklistDraft {
  if (!isRecord(input)) throw new Error('请求缺少清单数据');
  const id: string = text(input.id);
  const title: string = text(input.title);
  if (!id || id.length > 100) throw new Error('清单标识无效');
  if (!title || title.length > 80) {
    throw new Error('清单标题长度应为 1-80 个字符');
  }
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 50) {
    throw new Error('清单事项数量应为 1-50 项');
  }

  const ids: Set<string> = new Set();
  const items: ChecklistItem[] = input.items.map((item: unknown): ChecklistItem => {
    const itemId: string = isRecord(item) ? text(item.id) : '';
    const itemText: string = isRecord(item) ? text(item.text) : '';
    if (!itemId || itemId.length > 100) throw new Error('事项标识无效');
    if (ids.has(itemId)) throw new Error('事项标识重复');
    if (!itemText || itemText.length > 500) {
      throw new Error('事项内容长度应为 1-500 个字符');
    }
    ids.add(itemId);
    return {
      id: itemId,
      text: itemText,
      checked: false,
      images: parseImages(isRecord(item) ? item.images : null),
      videos: parseVideos(isRecord(item) ? item.videos : null),
    };
  });

  return { id, title, items };
}

export function parseStoredChecklist(input: unknown): ChecklistDraft {
  const draft: ChecklistDraft = parseChecklist(input);
  if (!isRecord(input) || !Array.isArray(input.items)) {
    throw new Error('清单存储格式无效');
  }
  const items: ChecklistItem[] = draft.items.map((item: ChecklistItem, index: number) => {
    const stored: unknown = input.items[index];
    if (!isRecord(stored) || typeof stored.checked !== 'boolean') {
      throw new Error('清单勾选状态无效');
    }
    return { ...item, checked: stored.checked };
  });
  return { ...draft, items };
}

export function updateChecklistItem(
  draft: ChecklistDraft, itemId: string, checked: boolean,
): ChecklistDraft {
  if (!draft.items.some((item: ChecklistItem) => item.id === itemId)) {
    throw new Error('事项不存在');
  }
  return {
    ...draft,
    items: draft.items.map((item: ChecklistItem) =>
      item.id === itemId ? { ...item, checked } : item),
  };
}
