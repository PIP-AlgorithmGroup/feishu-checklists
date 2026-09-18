const test = require("node:test");
const assert = require("node:assert/strict");

const {
  downloadStoredMedia,
  getUploadErrorMessage,
  parseImageInput,
  parseStoredMediaInput,
  parseVideoInput,
  uploadMedia,
} = require("./image.js");

test("accepts a PNG whose declared MIME matches its file signature", () => {
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32),
  ]);
  const image = parseImageInput({
    mimeType: "image/png",
    buffer: bytes,
  });

  assert.equal(image.extension, "png");
  assert.deepEqual(image.buffer, bytes);
});

test("rejects a file whose content does not match the declared image type", () => {
  assert.throws(
    () =>
      parseImageInput({
        mimeType: "image/png",
        buffer: Buffer.from("not an image"),
      }),
    /文件内容与图片类型不匹配/,
  );
});

test("rejects images larger than five megabytes", () => {
  const bytes = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff]),
    Buffer.alloc(5 * 1024 * 1024),
  ]);
  assert.throws(
    () =>
      parseImageInput({
        mimeType: "image/jpeg",
        buffer: bytes,
      }),
    /不能超过 5 MB/,
  );
});

test("accepts an MP4 video with a valid duration", () => {
  const bytes = Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from("ftyp", "ascii"),
    Buffer.from("isom0000", "ascii"),
  ]);
  const video = parseVideoInput({
    mimeType: "video/mp4",
    fileName: "walkthrough.mp4",
    duration: 12500,
    buffer: bytes,
  });

  assert.equal(video.fileName, "walkthrough.mp4");
  assert.equal(video.duration, 12500);
  assert.deepEqual(video.buffer, bytes);
});

test("rejects non-MP4 video content", () => {
  assert.throws(
    () =>
      parseVideoInput({
        mimeType: "video/mp4",
        fileName: "fake.mp4",
        duration: 1000,
        buffer: Buffer.from("not mp4"),
      }),
    /内容与 MP4 格式不匹配/,
  );
});

test("explains that Feishu bot capability is required for media upload", () => {
  assert.equal(
    getUploadErrorMessage(
      { msg: "App does not enable bot feature. Refer to the documentation" },
      400,
      "图片",
    ),
    "飞书应用未启用机器人能力，请在开发者后台添加“机器人”能力并发布新版本",
  );
});

test("accepts only media in this environment checklist directory", () => {
  assert.deepEqual(
    parseStoredMediaInput(
      {
        fileId: "cloud://env-1.bucket/checklist-media/file.png",
        downloadUrl: "https://env-1.tcb.qcloud.la/checklist-media/file.png?sign=ok",
      },
      "env-1",
    ),
    {
      fileId: "cloud://env-1.bucket/checklist-media/file.png",
      downloadUrl: "https://env-1.tcb.qcloud.la/checklist-media/file.png?sign=ok",
    },
  );

  assert.deepEqual(
    parseStoredMediaInput(
      {
        fileId: "cloud://env-1.bucket/checklist-media/file.png",
        downloadUrl:
          "https://env-1-1300000000.tcloudbaseapp.com/checklist-media/file.png?sign=ok",
      },
      "env-1",
    ),
    {
      fileId: "cloud://env-1.bucket/checklist-media/file.png",
      downloadUrl:
        "https://env-1-1300000000.tcloudbaseapp.com/checklist-media/file.png?sign=ok",
    },
  );

  assert.throws(
    () =>
      parseStoredMediaInput(
        {
          fileId: "cloud://env-1.bucket/private/file.png",
          downloadUrl: "https://env-1.tcb.qcloud.la/private/file.png?sign=ok",
        },
        "env-1",
      ),
    /存储路径无效/,
  );

  assert.deepEqual(
    parseStoredMediaInput(
      {
        fileId: "cloud://env-1.checklist-media/checklist-media/file.png",
        downloadUrl:
          "https://env-1.api.tcloudbasegateway.com/v1/storages/object/sign/checklist-media/checklist-media/file.png?token=ok",
      },
      "env-1",
    ),
    {
      fileId: "cloud://env-1.checklist-media/checklist-media/file.png",
      downloadUrl:
        "https://env-1.api.tcloudbasegateway.com/v1/storages/object/sign/checklist-media/checklist-media/file.png?token=ok",
    },
  );

  assert.throws(
    () =>
      parseStoredMediaInput(
        {
          fileId: "cloud://env-1.checklist-media/checklist-media/file.png",
          downloadUrl:
            "https://other-env.api.tcloudbasegateway.com/v1/storages/object/sign/checklist-media/checklist-media/file.png?token=ok",
        },
        "env-1",
      ),
    /下载地址无效/,
  );

  assert.throws(
    () =>
      parseStoredMediaInput(
        {
          fileId: "cloud://env-1.checklist-media/checklist-media/expected.png",
          downloadUrl:
            "https://env-1.api.tcloudbasegateway.com/v1/storages/object/sign/checklist-media/checklist-media/other.png?token=ok",
        },
        "env-1",
      ),
    /文件不匹配/,
  );

  for (const host of [
    "other-env.tcb.qcloud.la",
    "env-1-attacker.tcloudbaseapp.com",
    "attacker.tcloudbaseapp.com",
    "attacker.myqcloud.com",
  ]) {
    assert.throws(
      () =>
        parseStoredMediaInput(
          {
            fileId: "cloud://env-1.bucket/checklist-media/file.png",
            downloadUrl: `https://${host}/checklist-media/file.png?sign=ok`,
          },
          "env-1",
        ),
      /下载地址无效/,
    );
  }
});

test("downloads CloudBase media with an explicit size limit", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    headers: { get: (name) => (name === "content-length" ? "16" : null) },
    arrayBuffer: async () => Buffer.from("downloaded media"),
  });

  try {
    const buffer = await downloadStoredMedia(
      "https://env-1.tcb.qcloud.la/checklist-media/file.png?sign=ok",
      32,
    );
    assert.deepEqual(buffer, Buffer.from("downloaded media"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("does not accept the former Base64 upload transport", async () => {
  await assert.rejects(
    () =>
      uploadMedia(
        {
          mimeType: "image/png",
          dataBase64: Buffer.from("old transport").toString("base64"),
        },
        { envId: "env-1", appId: "app", appSecret: "secret" },
      ),
    /存储路径无效/,
  );
});

test("downloads stored media and preserves its CloudBase file id", async () => {
  const originalFetch = global.fetch;
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(16),
  ]);
  global.fetch = async (url) => {
    if (url.includes("tcb.qcloud.la")) {
      return {
        ok: true,
        headers: { get: () => String(bytes.length) },
        arrayBuffer: async () => bytes,
      };
    }
    if (url.includes("tenant_access_token")) {
      return {
        ok: true,
        json: async () => ({ code: 0, tenant_access_token: "token", expire: 7200 }),
      };
    }
    return {
      ok: true,
      json: async () => ({ code: 0, data: { image_key: "img_v3_test" } }),
    };
  };

  try {
    const uploaded = await uploadMedia(
      {
        fileId: "cloud://env-1.bucket/checklist-media/file.png",
        downloadUrl: "https://env-1.tcb.qcloud.la/checklist-media/file.png?sign=ok",
        mimeType: "image/png",
        fileName: "file.png",
      },
      { envId: "env-1", appId: "app", appSecret: "secret" },
    );
    assert.deepEqual(uploaded, {
      type: "image",
      fileId: "cloud://env-1.bucket/checklist-media/file.png",
      imageKey: "img_v3_test",
    });
  } finally {
    global.fetch = originalFetch;
  }
});
