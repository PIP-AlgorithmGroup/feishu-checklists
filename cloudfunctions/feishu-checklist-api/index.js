function getCloudBaseApiKey(env = process.env) {
  return env.CLOUDBASE_APIKEY || env.CLOUDBASE_API_KEY;
}

function parseChecklist(input) {
  if (!input || typeof input !== "object") throw new Error("请求缺少清单数据");
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!id || id.length > 100) throw new Error("清单标识无效");
  if (!title || title.length > 80) throw new Error("清单标题长度应为 1-80 个字符");
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 50) {
    throw new Error("清单事项数量应为 1-50 项");
  }

  const ids = new Set();
  const items = input.items.map((item) => {
    const itemId = typeof item?.id === "string" ? item.id.trim() : "";
    const text = typeof item?.text === "string" ? item.text.trim() : "";
    if (!itemId || itemId.length > 100) throw new Error("事项标识无效");
    if (ids.has(itemId)) throw new Error("事项标识重复");
    if (!text || text.length > 500) throw new Error("事项内容长度应为 1-500 个字符");
    ids.add(itemId);
    const images = Array.isArray(item.images) ? item.images : [];
    if (images.length > 3) throw new Error("每个事项最多添加 3 张图片");
    const normalizedImages = images.map((image) => {
      if (!image?.imageKey) throw new Error("事项图片标识无效");
      return {
        fileId: image.fileId || null,
        imageKey: image.imageKey,
        width: Number(image.width) || null,
        height: Number(image.height) || null,
        size: Number(image.size) || null,
      };
    });
    const videos = Array.isArray(item.videos) ? item.videos : [];
    if (videos.length > 3) throw new Error("每个事项最多添加 3 个视频");
    const normalizedVideos = videos.map((video) => {
      if (!video?.fileKey) throw new Error("事项视频标识无效");
      return {
        fileId: video.fileId || null,
        fileKey: video.fileKey,
        fileName: video.fileName || "video.mp4",
        duration: Number(video.duration) || null,
      };
    });
    return {
      id: itemId,
      text,
      checked: false,
      images: normalizedImages,
      videos: normalizedVideos,
    };
  });

  return { id, title, items };
}

function createRepository({ envId, apiKey }) {
  const endpoint =
    `https://${envId}.api.tcloudbasegateway.com` +
    "/v1/rdb/rest/rpc/create_checklist";
  return {
    async create(checklist) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          p_id: checklist.id,
          p_title: checklist.title,
          p_items: checklist.items,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          `数据库创建清单失败：${response.status} ${payload.message || payload.msg || ""}`.trim(),
        );
      }
      return payload;
    },
  };
}

function response(statusCode, body, origin) {
  return {
    statusCode,
    headers: {
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-origin": origin,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  };
}

exports.main = async (event) => {
  const allowedOrigin =
    process.env.FRONTEND_ORIGIN ||
    "https://feishu-checklist-d4ejfqy436026fb-1300423603.tcloudbaseapp.com";
  const origin = event.headers?.origin || event.headers?.Origin || "";
  if (origin && origin !== allowedOrigin) {
    return response(403, { code: 403, message: "请求来源不允许" }, allowedOrigin);
  }
  if (event.httpMethod === "OPTIONS" || event.requestContext?.http?.method === "OPTIONS") {
    return response(204, {}, allowedOrigin);
  }

  try {
    const envId = process.env.CLOUDBASE_ENV_ID;
    const apiKey = getCloudBaseApiKey();
    const appId = process.env.FEISHU_APP_ID;
    const appSecret = process.env.FEISHU_APP_SECRET;
    if (!envId || !apiKey || !appId || !appSecret) {
      throw new Error("云函数缺少 CloudBase 或飞书环境变量");
    }
    const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    const { exchangeAuthorizationCode, verifySessionToken } = require("./auth.js");
    if (body?.action === "authenticate") {
      const session = await exchangeAuthorizationCode(body.code, {
        appId,
        appSecret,
      });
      return response(200, { code: 0, data: session }, allowedOrigin);
    }

    const authorization =
      event.headers?.authorization || event.headers?.Authorization || "";
    verifySessionToken(authorization.replace(/^Bearer\s+/i, ""), appSecret);
    if (body?.action === "register_media") {
      const { uploadMedia } = require("./image.js");
      const uploaded = await uploadMedia(body, {
        appId,
        appSecret,
        envId,
      });
      return response(201, { code: 0, data: uploaded }, allowedOrigin);
    }
    const checklist = parseChecklist(body);
    await createRepository({ envId, apiKey }).create(checklist);
    return response(201, { code: 0, data: { id: checklist.id } }, allowedOrigin);
  } catch (error) {
    console.error("feishu-checklist-api failed:", error.message);
    return response(400, { code: 400, message: error.message }, allowedOrigin);
  }
};

exports.createRepository = createRepository;
exports.getCloudBaseApiKey = getCloudBaseApiKey;
exports.parseChecklist = parseChecklist;
