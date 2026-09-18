const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCardContent,
  buildChecklistCard,
  buildCompressionNotice,
  buildCloudbaseUploadBody,
  buildStoragePath,
  callJsApi,
  createMediaRegistrationPayload,
  buildTestCard,
  formatFileSize,
  formatImageMeta,
  getClipboardMediaFiles,
  getCloudbaseSignedUrl,
  getCloudbaseSignedUploadUrl,
  getMediaUploadBlockReason,
  getCloudbaseMediaReference,
  getSignableUrl,
  moveItem,
  parseBulkItems,
  parseTriggerCode,
  resolveCloudbaseAuth,
  requestJson,
  ensureCloudbaseSession,
  shouldCreateNewItem,
  shouldRefreshSession,
  uploadToSignedUrl,
  utf8Size,
} = require("../app.js");

test("fails a Feishu JSAPI call that never invokes a callback", async () => {
  await assert.rejects(
    callJsApi(
      { sendMessageCard() {} },
      "sendMessageCard",
      {},
      { timeoutMs: 10, timeoutMessage: "飞书发送超时" },
    ),
    /飞书发送超时/,
  );
});

test("accepts a Feishu JSAPI promise when callbacks are not invoked", async () => {
  const result = await callJsApi(
    { sendMessageCard: () => Promise.resolve({ sent: true }) },
    "sendMessageCard",
    {},
    { timeoutMs: 10, timeoutMessage: "飞书发送超时" },
  );

  assert.deepEqual(result, { sent: true });
});

test("fails an HTTP request whose response never arrives", async () => {
  await assert.rejects(
    requestJson("https://example.com", undefined, {
      timeoutMs: 10,
      timeoutMessage: "创建清单超时",
      fetchImpl: () => new Promise(() => {}),
    }),
    /创建清单超时/,
  );
});

test("parses triggerCode from both documented field names", () => {
  const current = new URL(
    "https://example.com/?bdp_launch_query=" +
      encodeURIComponent(JSON.stringify({ trigger_id: "current-code" })),
  );
  const legacy = new URL(
    "https://example.com/?bdp_launch_query=" +
      encodeURIComponent(JSON.stringify({ __trigger_id__: "legacy-code" })),
  );

  assert.equal(parseTriggerCode(current), "current-code");
  assert.equal(parseTriggerCode(legacy), "legacy-code");
});

test("returns null for missing or malformed launch data", () => {
  assert.equal(parseTriggerCode(new URL("https://example.com/")), null);
  assert.equal(
    parseTriggerCode(
      new URL("https://example.com/?bdp_launch_query=not-json"),
    ),
    null,
  );
});

test("signable URL keeps query and removes hash", () => {
  assert.equal(
    getSignableUrl("https://example.com/path?a=1#section"),
    "https://example.com/path?a=1",
  );
});

test("builds a callback checker card below the client limit", () => {
  const card = buildTestCard("checklist-1");
  const checker = card.body.elements[1];

  assert.equal(card.schema, "2.0");
  assert.equal(checker.tag, "checker");
  assert.equal(checker.checked, false);
  assert.deepEqual(checker.behaviors, [
    {
      type: "callback",
      value: { checklist_id: "checklist-1", item_id: "item-1" },
    },
  ]);
  assert.ok(utf8Size(JSON.stringify(card)) < 20 * 1024);
});

test("enables shared updates when sending the original card", () => {
  const cardContent = buildCardContent("checklist-1");

  assert.equal(cardContent.update_multi, true);
  assert.equal(cardContent.card.schema, "2.0");
  assert.equal(cardContent.card.config.enable_forward, false);
  assert.ok(utf8Size(JSON.stringify(cardContent)) < 20 * 1024);
});

test("parses non-empty trimmed lines into checklist items", () => {
  assert.deepEqual(parseBulkItems("  检查尺寸\n\n确认位置  \n检查尺寸"), [
    "检查尺寸",
    "确认位置",
    "检查尺寸",
  ]);
});

test("moves an item without mutating the original list", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

  assert.deepEqual(moveItem(items, 2, 0).map((item) => item.id), ["c", "a", "b"]);
  assert.deepEqual(items.map((item) => item.id), ["a", "b", "c"]);
});

test("uses Enter for a newline and Shift+Enter for a new item", () => {
  assert.equal(shouldCreateNewItem({ key: "Enter", shiftKey: false }), false);
  assert.equal(shouldCreateNewItem({ key: "Enter", shiftKey: true }), true);
});

test("exposes a five hundred character item limit", () => {
  assert.equal(require("../app.js").MAX_ITEM_TEXT_LENGTH, 500);
});

test("blocks media uploads until the Feishu session is authenticated", () => {
  assert.equal(
    getMediaUploadBlockReason(false, ""),
    "请等待当前会话完成身份验证后再上传媒体",
  );
  assert.equal(
    getMediaUploadBlockReason(true, ""),
    "请等待当前会话完成身份验证后再上传媒体",
  );
  assert.equal(getMediaUploadBlockReason(true, "session-token"), null);
});

test("refreshes a Feishu session before it expires", () => {
  assert.equal(shouldRefreshSession(0, 1_000_000), true);
  assert.equal(shouldRefreshSession(1_030_000, 1_000_000), true);
  assert.equal(shouldRefreshSession(1_120_000, 1_000_000), false);
});

test("describes an automatic image compression result", () => {
  assert.equal(formatFileSize(5 * 1024 * 1024), "5.0 MB");
  assert.equal(
    buildCompressionNotice("现场照片.png", 5 * 1024 * 1024, 2 * 1024 * 1024),
    "现场照片.png：5.0 MB → 2.0 MB",
  );
});

test("builds an isolated CloudBase media path without using the original name", () => {
  const path = buildStoragePath("image/jpeg", "123e4567-e89b-12d3-a456-426614174000");

  assert.equal(
    path,
    "checklist-media/123e4567-e89b-12d3-a456-426614174000.jpg",
  );
});

test("registers uploaded media by file id instead of Base64 content", () => {
  const payload = createMediaRegistrationPayload({
    fileId: "cloud://env.bucket/checklist-media/file.png",
    downloadUrl: "https://env.tcb.qcloud.la/checklist-media/file.png?sign=redacted",
    file: { type: "image/png", name: "现场.png" },
    duration: undefined,
  });

  assert.equal(payload.action, "register_media");
  assert.equal(payload.fileId, "cloud://env.bucket/checklist-media/file.png");
  assert.equal("dataBase64" in payload, false);
});

test("reads signed URLs from both CloudBase storage API versions", () => {
  assert.equal(
    getCloudbaseSignedUrl({ data: { signedUrl: "https://old.example/upload" } }),
    "https://old.example/upload",
  );
  assert.equal(
    getCloudbaseSignedUrl({ data: { fullSignedURL: "https://new.example/upload" } }),
    "https://new.example/upload",
  );
});

test("adds the CloudBase v3 upload token to the signed upload URL", () => {
  assert.equal(
    getCloudbaseSignedUploadUrl({
      data: {
        fullSignedURL: "https://storage.example/object/upload?source=web",
        token: "upload-token",
      },
    }),
    "https://storage.example/object/upload?source=web&token=upload-token",
  );
  assert.equal(
    getCloudbaseSignedUploadUrl({
      data: {
        fullSignedURL: "https://storage.example/object/upload?token=",
        token: "replacement",
      },
    }),
    "https://storage.example/object/upload?token=replacement",
  );
  assert.equal(
    getCloudbaseSignedUploadUrl({
      data: {
        fullSignedURL:
          "https://storage.example/v1/storages/v1/storages/object/upload/sign/checklist-media/file.png?token=stale",
        token: "replacement",
      },
    }),
    "https://storage.example/v1/storages/object/upload/sign/checklist-media/file.png?token=replacement",
  );
});

test("uses the object path for download signing and keeps the file id for storage", () => {
  assert.deepEqual(
    getCloudbaseMediaReference(
      { data: { id: "cloud://env.bucket/checklist-media/file.png" } },
      "checklist-media/file.png",
      "env",
      "bucket",
    ),
    {
      fileId: "cloud://env.bucket/checklist-media/file.png",
      downloadPath: "checklist-media/file.png",
    },
  );
  assert.deepEqual(
    getCloudbaseMediaReference(
      { data: { id: "internal-object-id" } },
      "checklist-media/file.png",
      "env",
      "bucket",
    ),
    {
      fileId: "cloud://env.bucket/checklist-media/file.png",
      downloadPath: "checklist-media/file.png",
    },
  );
});

test("uploads to a CloudBase v3 signed URL as multipart form data", async () => {
  const entries = [];
  class FakeFormData {
    append(name, value) {
      entries.push([name, value]);
    }
  }
  class FakeRequest {
    constructor() {
      this.upload = {};
      this.headers = [];
      FakeRequest.instance = this;
    }

    open(method, url) {
      this.method = method;
      this.url = url;
    }

    setRequestHeader(name, value) {
      this.headers.push([name, value]);
    }

    send(body) {
      this.body = body;
      this.status = 200;
      this.onload();
    }
  }
  const file = { type: "image/png", name: "image.png" };

  const body = buildCloudbaseUploadBody(file, FakeFormData);
  assert.deepEqual(entries, [
    ["contentType", "image/png"],
    ["", file],
  ]);

  await uploadToSignedUrl({
    uploadUrl: "https://storage.example/upload?token=redacted",
    file,
    onProgress() {},
    XMLHttpRequestCtor: FakeRequest,
    FormDataCtor: FakeFormData,
  });

  assert.equal(FakeRequest.instance.method, "PUT");
  assert.equal(FakeRequest.instance.url, "https://storage.example/upload?token=redacted");
  assert.ok(FakeRequest.instance.body instanceof FakeFormData);
  assert.deepEqual(FakeRequest.instance.headers, []);
});

test("shows the CloudBase error code, message, and request id for failed uploads", async () => {
  class FakeFormData {
    append() {}
  }
  class FailedRequest {
    constructor() {
      this.upload = {};
      this.status = 401;
      this.statusText = "Unauthorized";
      this.responseText = JSON.stringify({
        code: "AUTH_FAILED",
        message: "invalid upload token",
      });
    }

    open() {}

    getResponseHeader(name) {
      return name === "x-request-id" ? "req-123" : null;
    }

    send() {
      this.onload();
    }
  }

  await assert.rejects(
    uploadToSignedUrl({
      uploadUrl: "https://storage.example/upload?token=redacted",
      file: { type: "image/png" },
      onProgress() {},
      XMLHttpRequestCtor: FailedRequest,
      FormDataCtor: FakeFormData,
    }),
    /HTTP 401 Unauthorized.*AUTH_FAILED.*invalid upload token.*requestId=req-123/,
  );
});

test("prefers the CloudBase v2 auth API attached to app.auth", () => {
  let legacyFactoryCalls = 0;
  const auth = function legacyFactory() {
    legacyFactoryCalls += 1;
    return { signInAnonymously() {} };
  };
  auth.signInAnonymously = async () => ({ data: {}, error: null });
  auth.getSession = async () => ({ data: { session: null }, error: null });

  assert.equal(resolveCloudbaseAuth({ auth }), auth);
  assert.equal(legacyFactoryCalls, 0);
});

test("avoids the v2 getSession null-scope bug before anonymous sign-in", async () => {
  let signInCalls = 0;
  const auth = {
    hasLoginState() {
      return null;
    },
    async getSession() {
      throw new TypeError("Cannot read properties of null (reading 'scope')");
    },
    async signInAnonymously() {
      signInCalls += 1;
      return { data: { session: { access_token: "token" } }, error: null };
    },
  };

  await ensureCloudbaseSession(auth);

  assert.equal(signInCalls, 1);
});

test("configures the private checklist media bucket", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

  assert.match(html, /cloudbaseBucket:\s*"checklist-media"/);
  assert.match(html, /cloudbaseAccessKey:\s*"eyJ[^\"]+"/);
  assert.match(html, /cloudbase-js-sdk\/3\.8\.2\/cloudbase\.full\.js/);
  assert.match(html, /app\.js\?v=20260918-31/);
});

test("formats uploaded image dimensions and file size", () => {
  assert.equal(formatImageMeta(3024, 4032, 1.8 * 1024 * 1024), "3024 × 4032 · 1.8 MB");
});

test("builds a multi-item card with stable callback identifiers", () => {
  const card = buildChecklistCard({
    id: "checklist-1",
    title: "门店检查",
    items: [
      { id: "item-a", text: "检查尺寸", checked: false },
      { id: "item-b", text: "确认位置", checked: true },
    ],
  });

  assert.equal(card.body.elements[0].content, "**进度：1/2**");
  assert.equal(card.body.elements[1].behaviors[0].value.item_id, "item-a");
  assert.equal(card.body.elements[2].checked, true);
});

test("renders uploaded images after their checklist item", () => {
  const card = buildChecklistCard({
    id: "checklist-1",
    title: "门店检查",
    items: [
      {
        id: "item-a",
        text: "检查尺寸",
        checked: false,
        images: [{ imageKey: "img_v3_abc", fileId: "cloud://image" }],
      },
    ],
  });

  assert.equal(card.body.elements[2].tag, "img");
  assert.equal(card.body.elements[2].img_key, "img_v3_abc");
  assert.equal(card.body.elements[2].scale_type, "crop_center");
  assert.equal(card.body.elements[2].size, "medium");
  assert.equal(card.body.elements[2].preview, true);
  assert.equal(card.body.elements[2].mode, undefined);
  assert.equal(card.body.elements[2].compact_width, undefined);
});

test("extracts image and MP4 files from clipboard data", () => {
  const image = { type: "image/png", name: "screenshot.png" };
  const video = { type: "video/mp4", name: "walkthrough.mp4" };
  const text = { type: "text/plain", name: "note.txt" };
  const clipboardData = {
    items: [
      { kind: "string", type: "text/plain", getAsFile: () => null },
      { kind: "file", type: "image/png", getAsFile: () => image },
      { kind: "file", type: "video/mp4", getAsFile: () => video },
      { kind: "file", type: "text/plain", getAsFile: () => text },
    ],
  };

  assert.deepEqual(getClipboardMediaFiles(clipboardData), [image, video]);
  assert.deepEqual(getClipboardMediaFiles(null), []);
});

test("renders uploaded MP4 videos and disables card forwarding", () => {
  const card = buildChecklistCard({
    id: "checklist-1",
    title: "门店检查",
    items: [
      {
        id: "item-a",
        text: "检查动线",
        checked: false,
        videos: [{ fileKey: "file_v3_abc", fileName: "walkthrough.mp4" }],
      },
    ],
  });

  assert.equal(card.config.enable_forward, false);
  assert.equal(card.body.elements[2].tag, "video");
  assert.equal(card.body.elements[2].file_key, "file_v3_abc");
});
