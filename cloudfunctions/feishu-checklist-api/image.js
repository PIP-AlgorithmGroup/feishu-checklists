const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
let tokenCache = { value: "", expiresAt: 0 };

function isCloudbaseStorageHost(hostname, envId) {
  if (hostname === `${envId}.api.tcloudbasegateway.com`) return true;

  const escapedEnvId = String(envId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const legacySuffixes = ["tcb.qcloud.la", "tcloudbaseapp.com", "myqcloud.com"];
  return legacySuffixes.some((suffix) =>
    new RegExp(
      `^${escapedEnvId}(?:-\\d+)?(?:\\.[a-z0-9-]+)*\\.${suffix.replaceAll(".", "\\.")}$`,
      "i",
    ).test(hostname),
  );
}

function getUploadErrorMessage(payload, status, mediaName) {
  const message = payload?.msg || String(status);
  if (/does not enable bot feature/i.test(message)) {
    return "飞书应用未启用机器人能力，请在开发者后台添加“机器人”能力并发布新版本";
  }
  return `上传飞书${mediaName}失败：${message}`;
}

function parseImageInput(input) {
  const mimeType = input?.mimeType;
  const buffer = Buffer.isBuffer(input?.buffer) ? input.buffer : null;
  if (!buffer) {
    throw new Error("缺少图片内容");
  }
  const formats = {
    "image/jpeg": {
      extension: "jpg",
      matches: (buffer) =>
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff,
    },
    "image/png": {
      extension: "png",
      matches: (buffer) =>
        buffer.length >= 8 &&
        buffer.subarray(0, 8).equals(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        ),
    },
    "image/webp": {
      extension: "webp",
      matches: (buffer) =>
        buffer.length >= 12 &&
        buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
        buffer.subarray(8, 12).toString("ascii") === "WEBP",
    },
  };
  const format = formats[mimeType];
  if (!format) throw new Error("仅支持 JPG、PNG 和 WebP 图片");

  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error("处理后的单张图片不能超过 5 MB");
  }
  if (!format.matches(buffer)) throw new Error("文件内容与图片类型不匹配");
  return { buffer, mimeType, extension: format.extension };
}

function parseVideoInput(input) {
  if (input?.mimeType !== "video/mp4") throw new Error("仅支持 MP4 视频");
  const buffer = Buffer.isBuffer(input?.buffer) ? input.buffer : null;
  if (!buffer) {
    throw new Error("缺少视频内容");
  }
  if (buffer.length > MAX_VIDEO_BYTES) throw new Error("单个视频不能超过 30 MB");
  if (buffer.length < 12 || buffer.subarray(4, 8).toString("ascii") !== "ftyp") {
    throw new Error("文件内容与 MP4 格式不匹配");
  }
  const duration = Math.round(Number(input.duration));
  if (!Number.isFinite(duration) || duration < 1) throw new Error("视频时长无效");
  const rawName = typeof input.fileName === "string" ? input.fileName : "video.mp4";
  const fileName = rawName.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 120) || "video.mp4";
  return { buffer, mimeType: "video/mp4", fileName, duration };
}

function parseStoredMediaInput(input, envId) {
  const fileId = typeof input?.fileId === "string" ? input.fileId : "";
  const downloadUrl = typeof input?.downloadUrl === "string" ? input.downloadUrl : "";
  const escapedEnvId = String(envId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fileIdPattern = new RegExp(
    `^cloud://${escapedEnvId}(?:\\.[^/]+)?/checklist-media/[a-zA-Z0-9_-]+\\.(?:jpg|png|webp|mp4)$`,
  );
  if (!fileIdPattern.test(fileId)) throw new Error("CloudBase 媒体存储路径无效");

  let parsedUrl;
  try {
    parsedUrl = new URL(downloadUrl);
  } catch {
    throw new Error("CloudBase 媒体下载地址无效");
  }
  const allowedHost =
    parsedUrl.protocol === "https:" &&
    !parsedUrl.username &&
    !parsedUrl.password &&
    isCloudbaseStorageHost(parsedUrl.hostname, envId);
  if (!allowedHost || !parsedUrl.pathname.includes("/checklist-media/")) {
    throw new Error("CloudBase 媒体下载地址无效");
  }
  const objectPath = fileId.slice(fileId.indexOf("/checklist-media/") + 1);
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(parsedUrl.pathname);
  } catch {
    throw new Error("CloudBase 媒体下载地址无效");
  }
  if (!decodedPath.endsWith(`/${objectPath}`)) {
    throw new Error("CloudBase 媒体下载地址与文件不匹配");
  }
  return { fileId, downloadUrl };
}

async function downloadStoredMedia(downloadUrl, maxBytes) {
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`读取 CloudBase 媒体失败：HTTP ${response.status}`);
  }
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    throw new Error("CloudBase 媒体超过允许的体积");
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) throw new Error("CloudBase 媒体超过允许的体积");
  return buffer;
}

async function getTenantAccessToken({ appId, appSecret }) {
  if (tokenCache.value && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.value;
  }
  const response = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    },
  );
  const payload = await response.json();
  if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) {
    throw new Error(`获取飞书 tenant_access_token 失败：${payload.msg || response.status}`);
  }
  tokenCache = {
    value: payload.tenant_access_token,
    expiresAt: Date.now() + (payload.expire || 7200) * 1000,
  };
  return tokenCache.value;
}

async function uploadToFeishu(image, accessToken) {
  const form = new FormData();
  form.append("image_type", "message");
  form.append("image", new Blob([image.buffer], { type: image.mimeType }), `image.${image.extension}`);
  const response = await fetch("https://open.feishu.cn/open-apis/im/v1/images", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0 || !payload.data?.image_key) {
    throw new Error(getUploadErrorMessage(payload, response.status, "图片"));
  }
  return payload.data.image_key;
}

async function uploadVideoToFeishu(video, accessToken) {
  const form = new FormData();
  form.append("file_type", "mp4");
  form.append("file_name", video.fileName);
  form.append("duration", String(video.duration));
  form.append("file", new Blob([video.buffer], { type: video.mimeType }), video.fileName);
  const response = await fetch("https://open.feishu.cn/open-apis/im/v1/files", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0 || !payload.data?.file_key) {
    throw new Error(getUploadErrorMessage(payload, response.status, "视频"));
  }
  return payload.data.file_key;
}

async function uploadImage(input, { appId, appSecret }, fileId = null) {
  const image = parseImageInput(input);
  const accessToken = await getTenantAccessToken({ appId, appSecret });
  const imageKey = await uploadToFeishu(image, accessToken);
  return { fileId, imageKey };
}

async function uploadMedia(input, credentials) {
  const stored = parseStoredMediaInput(input, credentials.envId);
  const maxBytes = input?.mimeType === "video/mp4" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  const normalizedInput = {
    ...input,
    buffer: await downloadStoredMedia(stored.downloadUrl, maxBytes),
  };
  const fileId = stored.fileId;
  if (normalizedInput?.mimeType === "video/mp4") {
    const video = parseVideoInput(normalizedInput);
    const accessToken = await getTenantAccessToken(credentials);
    const fileKey = await uploadVideoToFeishu(video, accessToken);
    return {
      type: "video",
      fileId,
      fileKey,
      fileName: video.fileName,
      duration: video.duration,
    };
  }
  const image = await uploadImage(normalizedInput, credentials, fileId);
  return { type: "image", ...image };
}

module.exports = {
  downloadStoredMedia,
  getUploadErrorMessage,
  isCloudbaseStorageHost,
  parseImageInput,
  parseStoredMediaInput,
  parseVideoInput,
  uploadImage,
  uploadMedia,
};
