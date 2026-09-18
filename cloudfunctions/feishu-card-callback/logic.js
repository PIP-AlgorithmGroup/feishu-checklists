const crypto = require("node:crypto");

function verifySignature({ timestamp, nonce, encryptKey, body, signature }) {
  if (!timestamp || !nonce || !encryptKey || !body || !signature) return false;
  const expected = crypto
    .createHash("sha256")
    .update(timestamp + nonce + encryptKey + body)
    .digest("hex");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function decryptPayload(encrypted, encryptKey) {
  const key = crypto.createHash("sha256").update(encryptKey).digest();
  const encryptedBuffer = Buffer.from(encrypted, "base64");
  if (encryptedBuffer.length <= 16) {
    throw new Error("飞书加密回调密文长度无效");
  }
  const iv = encryptedBuffer.subarray(0, 16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  const decrypted = Buffer.concat([
    decipher.update(encryptedBuffer.subarray(16)),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8"));
}

function parseCallback(payload, config = {}) {
  if (payload.schema !== "2.0") throw new Error("不支持的回调版本");
  if (payload.header?.event_type !== "card.action.trigger") {
    throw new Error("不支持的回调类型");
  }
  if (config.appId && payload.header.app_id !== config.appId) {
    throw new Error("回调 App ID 不匹配");
  }
  if (
    config.verificationToken &&
    payload.header.token !== config.verificationToken
  ) {
    throw new Error("回调 Verification Token 不匹配");
  }

  const action = payload.event?.action;
  if (action?.tag !== "checker" || typeof action.checked !== "boolean") {
    throw new Error("回调不是有效的 checker 操作");
  }
  const value = action.value || {};
  if (!value.checklist_id || !value.item_id) {
    throw new Error("回调缺少清单或事项标识");
  }
  if (!payload.header.event_id) throw new Error("回调缺少 event_id");

  return {
    eventId: payload.header.event_id,
    checklistId: value.checklist_id,
    itemId: value.item_id,
    checked: action.checked,
    openMessageId: payload.event.context?.open_message_id,
    openChatId: payload.event.context?.open_chat_id,
  };
}

function renderCard(checklist) {
  const completed = checklist.items.filter((item) => item.checked).length;
  return {
    schema: "2.0",
    config: {
      update_multi: true,
      enable_forward: false,
    },
    header: {
      template: completed === checklist.items.length ? "green" : "blue",
      title: { tag: "plain_text", content: checklist.title },
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: `**进度：${completed}/${checklist.items.length}**`,
        },
        ...checklist.items.flatMap((item, index) => [
          {
            tag: "checker",
            element_id: `item_${index + 1}`,
            name: `item_${index + 1}`,
            checked: item.checked,
            text: { tag: "plain_text", content: item.text },
            checked_style: { show_strikethrough: true, opacity: 0.5 },
            behaviors: [
              {
                type: "callback",
                value: { checklist_id: checklist.id, item_id: item.id },
              },
            ],
          },
          ...(item.images || []).map((image) => ({
            tag: "img",
            img_key: image.imageKey,
            alt: { tag: "plain_text", content: item.text },
            mode: "fit_horizontal",
          })),
          ...(item.videos || []).map((video, videoIndex) => ({
            tag: "video",
            element_id: `video_${index + 1}_${videoIndex + 1}`,
            file_key: video.fileKey,
            enable_download: true,
            show_time: true,
            fallback: {
              tag: "fallback_text",
              text: { tag: "plain_text", content: "请升级飞书后查看视频" },
            },
          })),
        ]),
      ],
    },
  };
}

async function processCallback(payload, repository, config) {
  const event = parseCallback(payload, config);
  const result = await repository.apply(event);
  return {
    toast: {
      type: "success",
      content: result.duplicate ? "状态已是最新" : "状态已更新",
    },
    card: { type: "raw", data: renderCard(result.checklist) },
  };
}

module.exports = {
  decryptPayload,
  parseCallback,
  processCallback,
  renderCard,
  verifySignature,
};
