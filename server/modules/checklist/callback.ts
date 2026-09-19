import { createHash, createDecipheriv, timingSafeEqual } from 'node:crypto';
import type { ChecklistDraft, ChecklistItem } from '../../../shared/api.interface';
import type { ChecklistEvent } from './checklist';

interface CallbackConfig {
  appId?: string;
  verificationToken?: string;
  encryptKey?: string;
}

interface SignatureInput {
  timestamp: string;
  nonce: string;
  encryptKey: string;
  body: string;
  signature: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function verifySignature(input: SignatureInput): boolean {
  if (!input.timestamp || !input.nonce || !input.encryptKey ||
      !input.body || !input.signature) return false;
  const expected: Buffer = Buffer.from(createHash('sha256')
    .update(input.timestamp + input.nonce + input.encryptKey + input.body)
    .digest('hex'));
  const actual: Buffer = Buffer.from(input.signature);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function decryptPayload(encrypted: string, encryptKey: string): unknown {
  const bytes: Buffer = Buffer.from(encrypted, 'base64');
  if (bytes.length <= 16) throw new Error('飞书加密回调密文长度无效');
  const key: Buffer = createHash('sha256').update(encryptKey).digest();
  const decipher = createDecipheriv('aes-256-cbc', key, bytes.subarray(0, 16));
  const plaintext: Buffer = Buffer.concat([
    decipher.update(bytes.subarray(16)), decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

export function parseIncomingCallback(
  body: Buffer,
  headers: Record<string, string | string[] | undefined>,
  config: CallbackConfig,
): unknown {
  if (!config.appId || !config.verificationToken || !config.encryptKey) {
    throw new Error('飞书回调配置不完整');
  }
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new Error('飞书回调缺少原始请求体');
  }
  const timestamp: unknown = headers['x-lark-request-timestamp'];
  const nonce: unknown = headers['x-lark-request-nonce'];
  const signature: unknown = headers['x-lark-signature'];
  if (typeof timestamp !== 'string' || typeof nonce !== 'string' ||
      typeof signature !== 'string' || !verifySignature({
        timestamp, nonce, signature, encryptKey: config.encryptKey,
        body: body.toString('utf8'),
      })) {
    throw new Error('飞书回调签名无效');
  }
  const envelope: unknown = JSON.parse(body.toString('utf8'));
  const payload: unknown = record(envelope) && typeof envelope.encrypt === 'string'
    ? decryptPayload(envelope.encrypt, config.encryptKey) : envelope;
  if (record(payload) && payload.type === 'url_verification') {
    if (payload.token !== config.verificationToken ||
        typeof payload.challenge !== 'string' || !payload.challenge) {
      throw new Error('飞书 URL 校验无效');
    }
    return { challenge: payload.challenge };
  }
  return payload;
}

export function parseCallback(payload: unknown, config: CallbackConfig): ChecklistEvent {
  if (!record(payload) || payload.schema !== '2.0') {
    throw new Error('不支持的回调版本');
  }
  const header: unknown = payload.header;
  const event: unknown = payload.event;
  if (!record(header) || header.event_type !== 'card.action.trigger') {
    throw new Error('不支持的回调类型');
  }
  if (config.appId && header.app_id !== config.appId) {
    throw new Error('回调 App ID 不匹配');
  }
  if (config.verificationToken && header.token !== config.verificationToken) {
    throw new Error('回调 Verification Token 不匹配');
  }

  const action: unknown = record(event) ? event.action : null;
  const context: unknown = record(event) ? event.context : null;
  const value: unknown = record(action) ? action.value : null;
  if (!record(action) || action.tag !== 'checker' || typeof action.checked !== 'boolean') {
    throw new Error('回调不是有效的 checker 操作');
  }
  if (!record(value) || typeof value.checklist_id !== 'string' ||
      typeof value.item_id !== 'string' || !value.checklist_id || !value.item_id) {
    throw new Error('回调缺少清单或事项标识');
  }
  if (typeof header.event_id !== 'string' || !header.event_id) {
    throw new Error('回调缺少 event_id');
  }
  if (!record(context) || typeof context.open_message_id !== 'string' ||
      typeof context.open_chat_id !== 'string') {
    throw new Error('回调缺少消息或会话标识');
  }
  return {
    eventId: header.event_id,
    checklistId: value.checklist_id,
    itemId: value.item_id,
    checked: action.checked,
    openMessageId: context.open_message_id,
    openChatId: context.open_chat_id,
  };
}

export function renderCard(checklist: ChecklistDraft) {
  const completed: number = checklist.items.filter(
    (item: ChecklistItem) => item.checked,
  ).length;
  return {
    schema: '2.0',
    config: { update_multi: true, enable_forward: false },
    header: {
      template: completed === checklist.items.length ? 'green' : 'blue',
      title: { tag: 'plain_text', content: checklist.title },
    },
    body: {
      elements: [
        { tag: 'markdown', content: `**进度：${completed}/${checklist.items.length}**` },
        ...checklist.items.flatMap((item: ChecklistItem, index: number) => [
          {
            tag: 'checker', element_id: `item_${index + 1}`,
            name: `item_${index + 1}`, checked: item.checked,
            text: { tag: 'plain_text', content: item.text },
            checked_style: { show_strikethrough: true, opacity: 0.5 },
            behaviors: [{
              type: 'callback', value: { checklist_id: checklist.id, item_id: item.id },
            }],
          },
          ...item.images.map((image) => ({
            tag: 'img', img_key: image.imageKey,
            alt: { tag: 'plain_text', content: item.text },
            scale_type: 'crop_center', size: 'medium', preview: true,
          })),
          ...item.videos.map((video, videoIndex: number) => ({
            tag: 'video', element_id: `video_${index + 1}_${videoIndex + 1}`,
            file_key: video.fileKey, enable_download: true, show_time: true,
            fallback: {
              tag: 'fallback_text',
              text: { tag: 'plain_text', content: '请升级飞书后查看视频' },
            },
          })),
        ]),
      ],
    },
  };
}

export async function processCallback(
  payload: unknown,
  repository: {
    apply(event: ChecklistEvent): Promise<{ duplicate: boolean; checklist: ChecklistDraft }>;
  },
  config: CallbackConfig,
) {
  const event: ChecklistEvent = parseCallback(payload, config);
  const result: { duplicate: boolean; checklist: ChecklistDraft } = await repository.apply(event);
  return {
    toast: { type: 'success', content: result.duplicate ? '状态已是最新' : '状态已更新' },
    card: { type: 'raw', data: renderCard(result.checklist) },
  };
}
