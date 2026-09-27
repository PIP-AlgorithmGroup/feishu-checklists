import type { ChecklistDraft, ChecklistItem, ChecklistMessageBinding } from '@shared/api.interface';

export function parseSendReceipt(checklistId: string, result: unknown): ChecklistMessageBinding {
  if (typeof result !== 'object' || result === null || !('sendCardInfo' in result) ||
      !Array.isArray(result.sendCardInfo) || result.sendCardInfo.length !== 1) {
    throw new Error('飞书未返回单条卡片的发送成功回执');
  }
  const receipt: unknown = result.sendCardInfo[0];
  if (typeof receipt !== 'object' || receipt === null || !('status' in receipt) || receipt.status !== 0 ||
      !('openChatId' in receipt) || typeof receipt.openChatId !== 'string' ||
      !/^oc_[a-zA-Z0-9]+$/.test(receipt.openChatId) ||
      !('openMessageId' in receipt) || typeof receipt.openMessageId !== 'string' ||
      !/^om_[a-zA-Z0-9]+$/.test(receipt.openMessageId)) {
    throw new Error('飞书卡片发送回执缺少有效的对话或消息标识');
  }
  return { checklistId, openChatId: receipt.openChatId, openMessageId: receipt.openMessageId };
}

export function parseTriggerCode(value: string): string | null {
  const raw: string | null = new URL(value).searchParams.get('bdp_launch_query');
  if (!raw) return null;
  try {
    const query: Record<string, unknown> = JSON.parse(raw) as Record<string, unknown>;
    const code: unknown = query.trigger_id ?? query.__trigger_id__;
    return typeof code === 'string' && code ? code : null;
  } catch {
    return null;
  }
}

export function getSafeLoginReturnUrl(value: string): string {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

export function needsMiaodaLogin(status: number, userId: unknown): boolean {
  const validUserId = (typeof userId === 'number' && Number.isFinite(userId)) ||
    (typeof userId === 'string' && userId.length > 0);
  return status === 401 || !validUserId;
}

export function buildCardContent(checklist: ChecklistDraft) {
  const completed: number = checklist.items.filter((item: ChecklistItem) => item.checked).length;
  return {
    update_multi: true,
    card: {
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
                type: 'callback',
                value: { checklist_id: checklist.id, item_id: item.id },
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
              fallback: { tag: 'fallback_text', text: { tag: 'plain_text', content: '请升级飞书后查看视频' } },
            })),
          ]),
        ],
      },
    },
  };
}
