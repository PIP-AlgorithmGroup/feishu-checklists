(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ChecklistApp = api;
})(typeof window === "undefined" ? undefined : window, function () {
  const CARD_LIMIT_BYTES = 20 * 1024;
  const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
  const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
  const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
  const MAX_ITEM_TEXT_LENGTH = 500;

  function formatFileSize(bytes) {
    return bytes >= 1024 * 1024
      ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.ceil(bytes / 1024)} KB`;
  }

  function buildCompressionNotice(name, before, after) {
    return `${name}：${formatFileSize(before)} → ${formatFileSize(after)}`;
  }

  function buildStoragePath(mimeType, id) {
    const extensions = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "video/mp4": "mp4",
    };
    const extension = extensions[mimeType];
    if (!extension) throw new Error("不支持的媒体格式");
    return `checklist-media/${id}.${extension}`;
  }

  function createMediaRegistrationPayload({ fileId, downloadUrl, file, duration }) {
    return {
      action: "register_media",
      fileId,
      downloadUrl,
      mimeType: file.type,
      fileName: file.name,
      duration,
    };
  }

  function getCloudbaseSignedUrl(result) {
    return result?.data?.signedUrl || result?.data?.fullSignedURL || null;
  }

  function getCloudbaseSignedUploadUrl(result) {
    const signedUrl = getCloudbaseSignedUrl(result);
    const token = result?.data?.token;
    if (!signedUrl || !token) return signedUrl;

    const uploadUrl = new URL(signedUrl);
    uploadUrl.pathname = uploadUrl.pathname.replace(
      /^\/v1\/storages\/v1\/storages(?=\/)/,
      "/v1/storages",
    );
    uploadUrl.searchParams.set("token", token);
    return uploadUrl.toString();
  }

  function getCloudbaseMediaReference(info, storedPath, envId, bucket) {
    const infoId = info?.data?.id;
    return {
      fileId:
        typeof infoId === "string" && infoId.startsWith("cloud://")
          ? infoId
          : `cloud://${envId}.${bucket}/${storedPath}`,
      downloadPath: storedPath,
    };
  }

  function buildCloudbaseUploadBody(file, FormDataCtor = FormData) {
    const body = new FormDataCtor();
    body.append("contentType", file.type);
    body.append("", file);
    return body;
  }

  function sanitizeDiagnosticText(value) {
    return String(value || "")
      .replace(/([?&]token=)[^&\s"']+/gi, "$1<redacted>")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "<redacted>")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getCloudbaseResponseDetails(request) {
    const raw = sanitizeDiagnosticText(request.responseText);
    if (!raw) return [];

    try {
      const payload = JSON.parse(raw);
      const error = payload?.error && typeof payload.error === "object" ? payload.error : {};
      return [
        payload?.code || error.code,
        payload?.message || payload?.error_description || error.message,
      ]
        .filter(Boolean)
        .map(sanitizeDiagnosticText);
    } catch {
      const xmlCode = raw.match(/<Code>([^<]+)<\/Code>/i)?.[1];
      const xmlMessage = raw.match(/<Message>([^<]+)<\/Message>/i)?.[1];
      return xmlCode || xmlMessage
        ? [xmlCode, xmlMessage].filter(Boolean).map(sanitizeDiagnosticText)
        : [raw.slice(0, 400)];
    }
  }

  function getUploadRequestId(request) {
    const headerNames = ["x-request-id", "x-cos-request-id", "x-tcb-request-id"];
    for (const name of headerNames) {
      try {
        const value = request.getResponseHeader?.(name);
        if (value) return sanitizeDiagnosticText(value);
      } catch {
        // Cross-origin responses may not expose diagnostic headers.
      }
    }
    const raw = String(request.responseText || "");
    try {
      const payload = JSON.parse(raw);
      return sanitizeDiagnosticText(payload?.requestId || payload?.request_id);
    } catch {
      return sanitizeDiagnosticText(raw.match(/<RequestId>([^<]+)<\/RequestId>/i)?.[1]);
    }
  }

  function formatCloudbaseUploadError(request) {
    const status = [request.status, request.statusText].filter(Boolean).join(" ");
    const details = getCloudbaseResponseDetails(request);
    const requestId = getUploadRequestId(request);
    if (requestId) details.push(`requestId=${requestId}`);
    return `上传云存储失败：HTTP ${status || "未知"}${
      details.length ? ` · ${details.join(" · ")}` : " · 服务端未返回错误详情"
    }`;
  }

  function uploadToSignedUrl({
    uploadUrl,
    file,
    onProgress,
    XMLHttpRequestCtor = XMLHttpRequest,
    FormDataCtor = FormData,
  }) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequestCtor();
      request.open("PUT", uploadUrl);
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
      };
      request.onerror = () => reject(new Error("上传云存储连接被中断"));
      request.onload = () => {
        if (request.status >= 200 && request.status < 300) resolve();
        else reject(new Error(formatCloudbaseUploadError(request)));
      };
      request.send(buildCloudbaseUploadBody(file, FormDataCtor));
    });
  }

  function formatImageMeta(width, height, bytes) {
    return `${width} × ${height} · ${formatFileSize(bytes)}`;
  }

  function resolveCloudbaseAuth(app) {
    const directAuth = app?.auth;
    if (typeof directAuth?.signInAnonymously === "function") return directAuth;
    if (typeof directAuth === "function") {
      const legacyAuth = directAuth.call(app);
      if (typeof legacyAuth?.signInAnonymously === "function") return legacyAuth;
    }
    throw new Error("CloudBase 身份认证组件不可用");
  }

  async function ensureCloudbaseSession(auth) {
    let hasSession = false;
    if (typeof auth.hasLoginState === "function") {
      hasSession = Boolean(await auth.hasLoginState());
    } else if (typeof auth.getSession === "function") {
      const result = await auth.getSession();
      if (result?.error) {
        throw new Error(result.error.message || "读取 CloudBase 登录状态失败");
      }
      hasSession = Boolean(result?.data?.session);
    }
    if (hasSession) return;

    const result = await auth.signInAnonymously();
    if (result?.error) {
      throw new Error(result.error.message || "CloudBase 匿名登录失败");
    }
  }

  function parseTriggerCode(url) {
    const raw = url.searchParams.get("bdp_launch_query");
    if (!raw) return null;
    try {
      const launchQuery = JSON.parse(raw);
      return launchQuery.trigger_id || launchQuery.__trigger_id__ || null;
    } catch {
      return null;
    }
  }

  function getSignableUrl(href) {
    return href.split("#", 1)[0];
  }

  function parseBulkItems(value) {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function moveItem(items, fromIndex, toIndex) {
    if (
      fromIndex < 0 ||
      fromIndex >= items.length ||
      toIndex < 0 ||
      toIndex >= items.length
    ) {
      return [...items];
    }
    const result = [...items];
    const [item] = result.splice(fromIndex, 1);
    result.splice(toIndex, 0, item);
    return result;
  }

  function shouldCreateNewItem(event) {
    return event.key === "Enter" && event.shiftKey;
  }

  function getMediaUploadBlockReason(connected, sessionToken) {
    return connected && sessionToken
      ? null
      : "请等待当前会话完成身份验证后再上传媒体";
  }

  function shouldRefreshSession(expiresAt, now = Date.now()) {
    return !Number.isFinite(expiresAt) || expiresAt <= now + 60_000;
  }

  function getClipboardMediaFiles(clipboardData) {
    return [...(clipboardData?.items || [])]
      .filter(
        (item) =>
          item.kind === "file" &&
          (item.type.startsWith("image/") || item.type === "video/mp4"),
      )
      .map((item) => item.getAsFile())
      .filter(Boolean);
  }

  function buildChecklistCard(checklist) {
    const completed = checklist.items.filter((item) => item.checked).length;
    return {
      schema: "2.0",
      config: { enable_forward: false },
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
              mode: "crop_center",
              compact_width: true,
              preview: true,
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

  function buildTestCard(checklistId) {
    return buildChecklistCard({
      id: checklistId,
      title: "检查清单测试",
      items: [{ id: "item-1", text: "确认测试事项", checked: false }],
    });
  }

  function buildCardContent(checklist) {
    const normalized =
      typeof checklist === "string"
        ? {
            id: checklist,
            title: "检查清单测试",
            items: [{ id: "item-1", text: "确认测试事项", checked: false }],
          }
        : checklist;
    return {
      update_multi: true,
      card: buildChecklistCard(normalized),
    };
  }

  function utf8Size(value) {
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(value).byteLength;
    }
    return Buffer.byteLength(value, "utf8");
  }

  function withTimeout(promise, timeoutMs, timeoutMessage, onTimeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        onTimeout?.();
        reject(new Error(timeoutMessage));
      }, timeoutMs);
      Promise.resolve(promise).then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  async function requestJson(
    url,
    options,
    {
      timeoutMs = 20_000,
      timeoutMessage = "请求超时，请稍后重试",
      fetchImpl = fetch,
    } = {},
  ) {
    const controller = typeof AbortController === "undefined" ? null : new AbortController();
    const response = await withTimeout(
      fetchImpl(url, { ...options, ...(controller ? { signal: controller.signal } : {}) }),
      timeoutMs,
      timeoutMessage,
      () => controller?.abort(),
    );
    const payload = await withTimeout(response.json(), timeoutMs, timeoutMessage);
    return { response, payload };
  }

  function callJsApi(
    api,
    method,
    options,
    { timeoutMs = 20_000, timeoutMessage = "飞书操作超时，请稍后重试" } = {},
  ) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(timeoutMessage));
      }, timeoutMs);
      const finish = (callback) => (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      };
      try {
        const returned = api[method]({
          ...options,
          success: finish(resolve),
          fail: finish(reject),
        });
        if (returned && typeof returned.then === "function") {
          returned.then(finish(resolve), finish(reject));
        }
      } catch (error) {
        finish(reject)(error);
      }
    });
  }

  async function initialize() {
    const status = document.querySelector("#status");
    const detail = document.querySelector("#detail");
    const button = document.querySelector("#send-card");
    const titleInput = document.querySelector("#checklist-title");
    const addButton = document.querySelector("#add-item");
    const itemList = document.querySelector("#item-list");
    const itemCount = document.querySelector("#item-count");
    const config = window.FEISHU_CHECKLIST_CONFIG || {};
    const triggerCode = parseTriggerCode(new URL(window.location.href));
    let items = [
      {
        id: crypto.randomUUID(),
        text: "",
        checked: false,
        images: [],
        videos: [],
        uploads: [],
      },
    ];
    let connected = false;
    let sessionToken = "";
    let sessionExpiresAt = 0;
    let sessionRefreshPromise;
    let feishuAppId = "";
    let cloudStorageAppPromise;

    function authenticateSession() {
      if (sessionRefreshPromise) return sessionRefreshPromise;
      sessionRefreshPromise = (async () => {
        const auth = await callJsApi(
          window.tt,
          "requestAuthCode",
          { appId: feishuAppId },
          { timeoutMessage: "飞书身份授权超时，请关闭侧栏后重试" },
        );
        const { response: authResponse, payload: authPayload } = await requestJson(
          config.apiEndpoint,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "authenticate", code: auth.code }),
          },
          { timeoutMessage: "身份服务连接超时，请稍后重试" },
        );
        if (!authResponse.ok || authPayload.code !== 0) {
          throw new Error(authPayload.message || "用户身份校验失败");
        }
        sessionToken = authPayload.data.sessionToken;
        sessionExpiresAt = Number(authPayload.data.expiresAt);
        if (!sessionToken || !Number.isFinite(sessionExpiresAt)) {
          throw new Error("身份服务返回的会话信息无效");
        }
      })()
        .catch((error) => {
          sessionToken = "";
          sessionExpiresAt = 0;
          throw error;
        })
        .finally(() => {
          sessionRefreshPromise = null;
        });
      return sessionRefreshPromise;
    }

    async function ensureFeishuSession() {
      if (shouldRefreshSession(sessionExpiresAt)) await authenticateSession();
    }

    function show(message, description, state = "waiting") {
      status.textContent = message;
      status.dataset.state = state;
      detail.textContent = description;
      detail.dataset.state = state;
      detail.hidden = !description;
    }

    function currentChecklist(id = "preview") {
      return {
        id,
        title: titleInput.value.trim() || "检查清单",
        items: items.map((item) => ({
          id: item.id,
          text: item.text,
          checked: false,
          images: (item.images || []).map(({ fileId, imageKey, width, height, size }) => ({
            fileId,
            imageKey,
            width,
            height,
            size,
          })),
          videos: (item.videos || []).map(
            ({ fileId, fileKey, fileName, duration }) => ({
              fileId,
              fileKey,
              fileName,
              duration,
            }),
          ),
        })),
      };
    }

    async function getCloudStorageApp() {
      if (!cloudStorageAppPromise) {
        cloudStorageAppPromise = (async () => {
          if (!window.cloudbase) throw new Error("CloudBase 上传组件未加载");
          if (!config.cloudbaseEnvId) throw new Error("CloudBase 存储环境未配置");
          const app = window.cloudbase.init({
            env: config.cloudbaseEnvId,
            region: config.cloudbaseRegion || "ap-shanghai",
            ...(config.cloudbaseAccessKey
              ? { accessKey: config.cloudbaseAccessKey }
              : {}),
          });
          const auth = resolveCloudbaseAuth(app);
          await ensureCloudbaseSession(auth);
          return app;
        })().catch((error) => {
          cloudStorageAppPromise = null;
          throw error;
        });
      }
      return cloudStorageAppPromise;
    }

    async function uploadToCloudStorage(file, onProgress) {
      const app = await getCloudStorageApp();
      const cloudPath = buildStoragePath(file.type, crypto.randomUUID());
      const storage = app.storage.from(config.cloudbaseBucket || "checklist-media");
      const signedUpload = await storage.createSignedUploadUrl(cloudPath);
      if (signedUpload.error) {
        throw new Error(signedUpload.error.message || "创建云存储上传地址失败");
      }
      const uploadUrl = getCloudbaseSignedUploadUrl(signedUpload);
      if (!uploadUrl) throw new Error("CloudBase 未返回上传地址");
      await uploadToSignedUrl({ uploadUrl, file, onProgress });
      const storedPath = signedUpload.data.path || cloudPath;
      const info = await storage.info(storedPath);
      if (info.error) throw new Error(info.error.message || "读取云存储文件信息失败");
      const bucket = config.cloudbaseBucket || "checklist-media";
      const { fileId, downloadPath } = getCloudbaseMediaReference(
        info,
        storedPath,
        config.cloudbaseEnvId,
        bucket,
      );
      const signed = await storage.createSignedUrl(downloadPath, 600);
      if (signed.error) throw new Error(signed.error.message || "生成媒体下载地址失败");
      const downloadUrl = getCloudbaseSignedUrl(signed);
      if (!fileId || !downloadUrl) throw new Error("CloudBase 未返回媒体文件地址");
      return { fileId, downloadUrl };
    }

    function getVideoDuration(file) {
      return new Promise((resolve, reject) => {
        const video = document.createElement("video");
        const url = URL.createObjectURL(file);
        video.preload = "metadata";
        video.onloadedmetadata = () => {
          const duration = Math.round(video.duration * 1000);
          URL.revokeObjectURL(url);
          Number.isFinite(duration) && duration > 0
            ? resolve(duration)
            : reject(new Error("无法读取视频时长"));
        };
        video.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("无法读取 MP4 视频"));
        };
        video.src = url;
      });
    }

    function loadImage(file) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(file);
        image.onload = () => {
          URL.revokeObjectURL(url);
          resolve(image);
        };
        image.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("无法读取图片内容"));
        };
        image.src = url;
      });
    }

    function canvasToBlob(canvas, mimeType, quality) {
      return new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("图片压缩失败"))),
          mimeType,
          quality,
        );
      });
    }

    async function compressImage(file, onProgress) {
      if (file.size <= MAX_IMAGE_UPLOAD_BYTES) return { file, compressed: false };
      if (file.size > MAX_SOURCE_IMAGE_BYTES) {
        throw new Error("待压缩图片不能超过 20 MB");
      }

      const image = await loadImage(file);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: file.type === "image/png" });
      if (!context) throw new Error("当前设备不支持图片压缩");

      const sizeRatio = Math.min(
        1,
        Math.sqrt((MAX_IMAGE_UPLOAD_BYTES * 0.88) / file.size),
      );
      const dimensionRatio = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
      let scale = Math.min(sizeRatio, dimensionRatio);
      let quality = 0.88;
      let blob;
      for (let attempt = 1; attempt <= 8; attempt += 1) {
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        blob = await canvasToBlob(canvas, file.type, quality);
        onProgress(Math.min(18, attempt * 2));
        if (blob.size <= MAX_IMAGE_UPLOAD_BYTES) break;
        scale *= 0.82;
        quality = Math.max(0.55, quality - 0.07);
      }
      if (!blob || blob.size > MAX_IMAGE_UPLOAD_BYTES) {
        throw new Error("图片自动压缩后仍超过上传通道限制");
      }
      return {
        compressed: true,
        file: new File([blob], file.name, { type: file.type, lastModified: file.lastModified }),
      };
    }

    function postMedia(payload, onProgress) {
      return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("POST", config.apiEndpoint);
        request.setRequestHeader("authorization", `Bearer ${sessionToken}`);
        request.setRequestHeader("content-type", "application/json");
        request.upload.onload = () => onProgress(92);
        request.onerror = () =>
          reject(new Error("媒体登记连接被中断，请稍后重试"));
        request.onload = () => {
          let response;
          try {
            response = JSON.parse(request.responseText);
          } catch {
            reject(new Error(`上传服务返回 HTTP ${request.status}`));
            return;
          }
          if (request.status < 200 || request.status >= 300 || response.code !== 0) {
            reject(new Error(response.message || `上传服务返回 HTTP ${request.status}`));
            return;
          }
          resolve(response.data);
        };
        request.send(JSON.stringify(payload));
      });
    }

    function setUploadProgress(task, progress, label) {
      task.progress = Math.max(task.progress || 0, Math.round(progress));
      task.label = label;
      const row = document.querySelector(`[data-upload-id="${task.id}"]`);
      if (!row) return;
      row.querySelector(".upload-progress-bar").style.width = `${task.progress}%`;
      row.querySelector(".upload-state").textContent = label;
    }

    async function uploadOneMedia(item, file, task) {
      const isVideo = file.type === "video/mp4";
      if (!isVideo && !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        throw new Error("仅支持 JPG、PNG、WebP 图片和 MP4 视频");
      }
      if (isVideo && file.size > MAX_VIDEO_BYTES) {
        throw new Error("视频超过飞书 30 MB 上限，当前版本不支持自动压缩视频");
      }

      let uploadFile = file;
      if (!isVideo && file.size > MAX_IMAGE_UPLOAD_BYTES) {
        setUploadProgress(task, 1, "压缩中");
        const result = await compressImage(file, (progress) =>
          setUploadProgress(task, progress, "压缩中"),
        );
        uploadFile = result.file;
        task.compressionNotice = buildCompressionNotice(file.name, file.size, uploadFile.size);
      }

      const duration = isVideo ? await getVideoDuration(uploadFile) : undefined;
      let imageMeta;
      if (!isVideo) {
        const image = await loadImage(uploadFile);
        imageMeta = {
          width: image.naturalWidth,
          height: image.naturalHeight,
          size: uploadFile.size,
        };
        task.mediaMeta = formatImageMeta(
          imageMeta.width,
          imageMeta.height,
          imageMeta.size,
        );
      }
      setUploadProgress(task, 18, "上传云存储");
      const stored = await uploadToCloudStorage(uploadFile, (progress) =>
        setUploadProgress(task, 18 + progress * 0.67, "上传云存储"),
      );
      setUploadProgress(task, 86, "同步到飞书");
      await ensureFeishuSession();
      const uploaded = await postMedia(
        createMediaRegistrationPayload({
          ...stored,
          file: uploadFile,
          duration,
        }),
        (progress) => setUploadProgress(task, progress, "同步到飞书"),
      );
      const media = {
        ...uploaded,
        ...imageMeta,
        previewUrl: URL.createObjectURL(uploadFile),
      };
      if (uploaded.type === "video") item.videos.push(media);
      else item.images.push(media);
      task.status = "done";
      setUploadProgress(
        task,
        100,
        task.mediaMeta || (task.compressionNotice ? "已压缩并上传" : "已完成"),
      );
    }

    async function uploadItemMedia(item, files) {
      const blockReason = getMediaUploadBlockReason(connected, sessionToken);
      if (blockReason) {
        show("正在连接飞书", blockReason, "waiting");
        return;
      }
      try {
        await ensureFeishuSession();
      } catch (error) {
        show("身份验证失败", error.message || String(error), "error");
        render();
        return;
      }

      const active = (item.uploads || []).filter((task) => task.status === "uploading");
      let imageSlots = 3 - item.images.length - active.filter((task) => task.kind === "image").length;
      let videoSlots = 3 - item.videos.length - active.filter((task) => task.kind === "video").length;
      const selected = [...files].filter((file) => {
        if (file.type === "video/mp4" && videoSlots > 0) return videoSlots-- > 0;
        if (file.type.startsWith("image/") && imageSlots > 0) return imageSlots-- > 0;
        return false;
      });
      if (selected.length === 0) {
        show("无法添加媒体", "仅支持 JPG、PNG、WebP 和 MP4；每类每项最多 3 个。", "error");
        return;
      }

      const tasks = selected.map((file) => ({
        id: crypto.randomUUID(),
        file,
        name: file.name || (file.type === "video/mp4" ? "粘贴的视频.mp4" : "粘贴的图片"),
        kind: file.type === "video/mp4" ? "video" : "image",
        progress: 0,
        label: "等待上传",
        status: "uploading",
      }));
      item.uploads.push(...tasks);
      show("正在上传媒体", `${tasks.length} 个文件并行处理中。`, "waiting");
      render();
      await Promise.all(
        tasks.map(async (task) => {
          try {
            await uploadOneMedia(item, task.file, task);
          } catch (error) {
            task.status = "error";
            task.error = error.message || String(error);
            task.label = "上传失败";
          }
          render();
        }),
      );
      const failed = tasks.filter((task) => task.status === "error").length;
      const compressionNotices = tasks
        .map((task) => task.compressionNotice)
        .filter(Boolean);
      show(
        failed ? "部分媒体上传失败" : "媒体已上传",
        failed
          ? `${failed} 个文件失败，可删除后重试。`
          : compressionNotices.length > 0
            ? `已自动压缩：${compressionNotices.join("；")}`
            : "",
        failed ? "error" : "ready",
      );
      updateSendState();
    }

    function addItemAfter(index, text = "") {
      if (items.length >= 50) return null;
      const item = {
        id: crypto.randomUUID(),
        text,
        checked: false,
        images: [],
        videos: [],
        uploads: [],
      };
      items.splice(index + 1, 0, item);
      return item.id;
    }

    function render(focusId) {
      itemList.replaceChildren();
      items.forEach((item, index) => {
        const block = document.createElement("div");
        block.className = "item-block";
        const row = document.createElement("div");
        row.className = "item-row";
        row.dataset.id = item.id;

        const marker = document.createElement("span");
        marker.className = "item-marker";
        marker.setAttribute("aria-hidden", "true");
        const input = document.createElement("textarea");
        input.className = "item-text";
        input.rows = 1;
        input.value = item.text;
        input.maxLength = MAX_ITEM_TEXT_LENGTH;
        input.placeholder = "输入事项";
        input.setAttribute("aria-label", `事项 ${index + 1}`);
        const resizeInput = () => {
          input.style.height = "0";
          input.style.height = `${input.scrollHeight}px`;
        };
        input.addEventListener("input", () => {
          item.text = input.value;
          resizeInput();
          updateSendState();
        });
        input.addEventListener("keydown", (event) => {
          if (shouldCreateNewItem(event)) {
            event.preventDefault();
            const cursor = input.selectionStart;
            const remainder = item.text.slice(cursor).trimStart();
            item.text = item.text.slice(0, cursor).trimEnd();
            const nextId = addItemAfter(index, remainder);
            render(nextId);
          } else if (
            event.key === "Backspace" &&
            !item.text &&
            (item.images || []).length === 0 &&
            (item.videos || []).length === 0 &&
            !(item.uploads || []).some((task) => task.status === "uploading") &&
            items.length > 1
          ) {
            event.preventDefault();
            const previousId = items[Math.max(0, index - 1)].id;
            items.splice(index, 1);
            render(previousId);
          }
        });
        input.addEventListener("paste", async (event) => {
          const pastedMedia = getClipboardMediaFiles(event.clipboardData);
          if (pastedMedia.length > 0) {
            event.preventDefault();
            await uploadItemMedia(item, pastedMedia);
            return;
          }
          const lines = parseBulkItems(event.clipboardData?.getData("text/plain") || "");
          if (lines.length <= 1) return;
          event.preventDefault();
          const cursor = input.selectionStart;
          const prefix = item.text.slice(0, cursor);
          const suffix = item.text.slice(input.selectionEnd);
          item.text = `${prefix}${lines[0]}`.slice(0, MAX_ITEM_TEXT_LENGTH);
          let insertionIndex = index;
          let lastId = item.id;
          lines.slice(1).forEach((line, lineIndex) => {
            const text = lineIndex === lines.length - 2 ? `${line}${suffix}` : line;
            const insertedId = addItemAfter(
              insertionIndex,
              text.slice(0, MAX_ITEM_TEXT_LENGTH),
            );
            if (insertedId) {
              insertionIndex += 1;
              lastId = insertedId;
            }
          });
          render(lastId);
        });
        row.append(marker, input);
        block.append(row);

        const tools = document.createElement("div");
        tools.className = "item-tools";

        const mediaInput = document.createElement("input");
        mediaInput.type = "file";
        mediaInput.accept = "image/jpeg,image/png,image/webp,video/mp4";
        mediaInput.multiple = true;
        mediaInput.hidden = true;
        mediaInput.addEventListener("change", async () => {
          await uploadItemMedia(item, mediaInput.files);
          mediaInput.value = "";
        });
        const addMedia = document.createElement("button");
        addMedia.type = "button";
        addMedia.className = "media-button";
        addMedia.textContent = "添加图片或视频";
        addMedia.title = "选择多个文件，也可直接粘贴";
        addMedia.setAttribute("aria-label", "添加图片或视频");
        addMedia.disabled =
          Boolean(getMediaUploadBlockReason(connected, sessionToken)) ||
          (item.images || []).length >= 3 && (item.videos || []).length >= 3;
        addMedia.addEventListener("click", () => mediaInput.click());
        tools.append(addMedia, mediaInput);

        [
          ["↑", "上移", index - 1],
          ["↓", "下移", index + 1],
        ].forEach(([symbol, label, target]) => {
          const control = document.createElement("button");
          control.type = "button";
          control.className = "icon-button";
          control.textContent = symbol;
          control.title = label;
          control.setAttribute("aria-label", label);
          control.disabled = target < 0 || target >= items.length;
          control.addEventListener("click", () => {
            items = moveItem(items, index, target);
            render();
          });
          tools.append(control);
        });

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "icon-button danger";
        remove.textContent = "×";
        remove.title = "删除";
        remove.setAttribute("aria-label", "删除");
        remove.disabled = (item.uploads || []).some((task) => task.status === "uploading");
        remove.addEventListener("click", () => {
          if (items.length === 1) {
            item.text = "";
            item.images.forEach((image) => image.previewUrl && URL.revokeObjectURL(image.previewUrl));
            item.videos.forEach((video) => video.previewUrl && URL.revokeObjectURL(video.previewUrl));
            item.images = [];
            item.videos = [];
            item.uploads = [];
            render(item.id);
            return;
          }
          items = items.filter((candidate) => candidate.id !== item.id);
          render(items[Math.max(0, index - 1)]?.id);
        });
        tools.append(remove);
        block.append(tools);
        if ((item.uploads || []).length > 0) {
          const uploads = document.createElement("div");
          uploads.className = "upload-list";
          item.uploads.forEach((task) => {
            const upload = document.createElement("div");
            upload.className = `upload-row upload-${task.status}`;
            upload.dataset.uploadId = task.id;
            const meta = document.createElement("div");
            meta.className = "upload-meta";
            const name = document.createElement("span");
            name.className = "upload-name";
            name.textContent = task.name;
            const state = document.createElement("span");
            state.className = "upload-state";
            state.textContent = task.error || task.label;
            meta.append(name, state);
            const track = document.createElement("div");
            track.className = "upload-progress";
            const bar = document.createElement("span");
            bar.className = "upload-progress-bar";
            bar.style.width = `${task.progress}%`;
            track.append(bar);
            upload.append(meta, track);
            if (task.status === "error" || task.status === "done") {
              const dismiss = document.createElement("button");
              dismiss.type = "button";
              dismiss.className = "upload-dismiss";
              dismiss.textContent = "×";
              dismiss.title = "关闭上传记录";
              dismiss.setAttribute("aria-label", "关闭上传记录");
              dismiss.addEventListener("click", () => {
                item.uploads = item.uploads.filter((candidate) => candidate.id !== task.id);
                render();
              });
              upload.append(dismiss);
            }
            uploads.append(upload);
          });
          block.append(uploads);
        }
        if ((item.images || []).length > 0) {
          const thumbnails = document.createElement("div");
          thumbnails.className = "thumbnails";
          item.images.forEach((image, imageIndex) => {
            const thumbnail = document.createElement("div");
            thumbnail.className = "thumbnail";
            const picture = document.createElement("img");
            picture.src = image.previewUrl || "";
            picture.alt = item.text;
            const removeImage = document.createElement("button");
            removeImage.type = "button";
            removeImage.textContent = "×";
            removeImage.title = "删除图片";
            removeImage.setAttribute("aria-label", "删除图片");
            removeImage.addEventListener("click", () => {
              if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
              item.images.splice(imageIndex, 1);
              render();
            });
            thumbnail.append(picture, removeImage);
            if (image.width && image.height && image.size) {
              const meta = document.createElement("span");
              meta.className = "media-meta";
              meta.textContent = formatImageMeta(image.width, image.height, image.size);
              thumbnail.append(meta);
            }
            thumbnails.append(thumbnail);
          });
          block.append(thumbnails);
        }
        if ((item.videos || []).length > 0) {
          const videos = document.createElement("div");
          videos.className = "thumbnails";
          item.videos.forEach((video, videoIndex) => {
            const thumbnail = document.createElement("div");
            thumbnail.className = "thumbnail";
            const player = document.createElement("video");
            player.src = video.previewUrl || "";
            player.controls = true;
            player.preload = "metadata";
            player.setAttribute("playsinline", "");
            const removeVideo = document.createElement("button");
            removeVideo.type = "button";
            removeVideo.textContent = "×";
            removeVideo.title = "删除视频";
            removeVideo.setAttribute("aria-label", "删除视频");
            removeVideo.addEventListener("click", () => {
              if (video.previewUrl) URL.revokeObjectURL(video.previewUrl);
              item.videos.splice(videoIndex, 1);
              render();
            });
            thumbnail.append(player, removeVideo);
            videos.append(thumbnail);
          });
          block.append(videos);
        }
        itemList.append(block);
        resizeInput();
        if (item.id === focusId) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
      });
      itemCount.textContent = `${items.length} 项`;
      updateSendState();
    }

    function updateSendState() {
      button.disabled =
        !connected ||
        items.length === 0 ||
        items.some((item) => !item.text.trim()) ||
        items.some((item) =>
          (item.uploads || []).some((task) => task.status === "uploading"),
        ) ||
        !titleInput.value.trim();
      button.textContent = `发送清单 · ${items.length} 项`;
    }

    addButton.addEventListener("click", () => render(addItemAfter(items.length - 1)));
    titleInput.addEventListener("input", updateSendState);
    render();

    if (!triggerCode) {
      show("请从飞书会话打开", "当前页面没有检测到会话启动参数。", "error");
      return;
    }
    if (!window.h5sdk || !window.tt) {
      show("飞书 JS SDK 未加载", "请确认页面在飞书客户端内打开。", "error");
      return;
    }
    if (!config.signEndpoint || !config.apiEndpoint) {
      show("入口识别成功", "签名服务尚未配置。", "waiting");
      return;
    }

    try {
      show("正在连接飞书", "正在完成 JSAPI 鉴权。", "waiting");
      const signUrl = new URL(config.signEndpoint);
      signUrl.searchParams.set("url", getSignableUrl(window.location.href));
      const { response, payload } = await requestJson(
        signUrl,
        undefined,
        { timeoutMessage: "签名服务连接超时，请稍后重试" },
      );
      if (!response.ok || payload.code !== 0) {
        throw new Error(payload.message || `签名服务返回 HTTP ${response.status}`);
      }

      await new Promise((resolve, reject) => {
        window.h5sdk.config({
          ...payload.data,
          jsApiList: ["getTriggerContext", "requestAuthCode", "sendMessageCard"],
          onSuccess: resolve,
          onFail: reject,
        });
      });

      feishuAppId = payload.data.appId;
      await authenticateSession();

      show("当前会话已连接", "", "ready");
      connected = true;
      render();
      button.addEventListener("click", async () => {
        button.disabled = true;
        show("正在发送", "卡片将进入当前会话。", "waiting");
        try {
          await ensureFeishuSession();
          const checklist = currentChecklist(crypto.randomUUID());
          const cardContent = buildCardContent(checklist);
          if (utf8Size(JSON.stringify(cardContent)) > CARD_LIMIT_BYTES) {
            throw new Error("卡片内容超过 20 KB 客户端限制");
          }
          show("正在保存清单", "正在写入清单状态。", "waiting");
          const { response: createResponse, payload: createPayload } = await requestJson(
            config.apiEndpoint,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${sessionToken}`,
                "content-type": "application/json",
              },
              body: JSON.stringify(checklist),
            },
            { timeoutMessage: "创建清单超时，请稍后重试" },
          );
          if (!createResponse.ok || createPayload.code !== 0) {
            throw new Error(createPayload.message || "创建清单失败");
          }
          show("正在发送到飞书", "正在调用当前会话发送接口。", "waiting");
          await callJsApi(
            window.tt,
            "sendMessageCard",
            { triggerCode, cardContent },
            { timeoutMessage: "飞书发送超时，请关闭侧栏后重试" },
          );
          show("清单已发送", "", "ready");
          updateSendState();
        } catch (error) {
          show("发送失败", error.message || JSON.stringify(error), "error");
          updateSendState();
        }
      });
    } catch (error) {
      show("鉴权失败", error.message || JSON.stringify(error), "error");
    }
  }

  if (typeof window !== "undefined") {
    window.addEventListener("DOMContentLoaded", initialize);
  }

  return {
    buildCardContent,
    buildChecklistCard,
    buildCloudbaseUploadBody,
    buildCompressionNotice,
    buildStoragePath,
    buildTestCard,
    callJsApi,
    createMediaRegistrationPayload,
    ensureCloudbaseSession,
    formatFileSize,
    formatImageMeta,
    getClipboardMediaFiles,
    getCloudbaseMediaReference,
    getCloudbaseSignedUrl,
    getCloudbaseSignedUploadUrl,
    getSignableUrl,
    getMediaUploadBlockReason,
    moveItem,
    MAX_ITEM_TEXT_LENGTH,
    parseBulkItems,
    parseTriggerCode,
    resolveCloudbaseAuth,
    requestJson,
    shouldCreateNewItem,
    shouldRefreshSession,
    uploadToSignedUrl,
    utf8Size,
    withTimeout,
  };
});
