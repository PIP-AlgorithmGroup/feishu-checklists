const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseChecklist,
  createRepository,
  getCloudBaseApiKey,
  main,
} = require("./index.js");
const { createSessionToken } = require("./auth.js");

function withApiEnvironment(run) {
  const keys = [
    "CLOUDBASE_ENV_ID",
    "CLOUDBASE_APIKEY",
    "FEISHU_APP_ID",
    "FEISHU_APP_SECRET",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    CLOUDBASE_ENV_ID: "env-1",
    CLOUDBASE_APIKEY: "database-key",
    FEISHU_APP_ID: "app-id",
    FEISHU_APP_SECRET: "app-secret",
  });
  return Promise.resolve()
    .then(run)
    .finally(() => {
      keys.forEach((key) => {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      });
    });
}

test("validates and normalizes a checklist", () => {
  assert.deepEqual(
    parseChecklist({
      id: "checklist-1",
      title: "  门店检查  ",
      items: [
        { id: "item-a", text: " 检查尺寸 " },
        { id: "item-b", text: "确认位置" },
      ],
    }),
    {
      id: "checklist-1",
      title: "门店检查",
      items: [
        { id: "item-a", text: "检查尺寸", checked: false, images: [], videos: [] },
        { id: "item-b", text: "确认位置", checked: false, images: [], videos: [] },
      ],
    },
  );
});

test("accepts item text up to five hundred characters", () => {
  const checklist = parseChecklist({
    id: "checklist-1",
    title: "门店检查",
    items: [{ id: "item-1", text: "事项".repeat(250) }],
  });

  assert.equal(checklist.items[0].text.length, 500);
  assert.throws(
    () =>
      parseChecklist({
        id: "checklist-1",
        title: "门店检查",
        items: [{ id: "item-1", text: `${"事项".repeat(250)}超` }],
      }),
    /1-500 个字符/,
  );
});

test("rejects duplicate item identifiers", () => {
  assert.throws(
    () =>
      parseChecklist({
        id: "checklist-1",
        title: "门店检查",
        items: [
          { id: "same", text: "检查尺寸" },
          { id: "same", text: "确认位置" },
        ],
      }),
    /事项标识重复/,
  );
});

test("calls the create checklist RPC", async () => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ id: "checklist-1" }) };
  };

  try {
    const repository = createRepository({ envId: "env-1", apiKey: "key" });
    await repository.create({
      id: "checklist-1",
      title: "门店检查",
      items: [{ id: "item-a", text: "检查尺寸", checked: false }],
    });
    assert.match(request.url, /rpc\/create_checklist$/);
    assert.equal(request.options.headers.authorization, "Bearer key");
  } finally {
    global.fetch = originalFetch;
  }
});

test("prefers the managed CloudBase API key", () => {
  assert.equal(
    getCloudBaseApiKey({ CLOUDBASE_APIKEY: "managed", CLOUDBASE_API_KEY: "old" }),
    "managed",
  );
});

test("rejects unauthenticated media before any remote request", async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("remote request must not run");
  };

  try {
    await withApiEnvironment(async () => {
      const result = await main({
        headers: { authorization: "Bearer invalid-session" },
        body: JSON.stringify({ action: "register_media" }),
      });
      assert.equal(result.statusCode, 400);
      assert.match(JSON.parse(result.body).message, /身份凭证无效/);
      assert.equal(fetchCalls, 0);
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("valid session reaches media registration through the API handler", async () => {
  const originalFetch = global.fetch;
  const originalOrigin = process.env.FRONTEND_ORIGIN;
  const imageBytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(16),
  ]);
  const requested = [];
  global.fetch = async (url) => {
    requested.push(String(url));
    if (String(url).includes("api.tcloudbasegateway.com/v1/storages/")) {
      return {
        ok: true,
        headers: { get: () => String(imageBytes.length) },
        arrayBuffer: async () => imageBytes,
      };
    }
    if (String(url).includes("tenant_access_token")) {
      return {
        ok: true,
        json: async () => ({ code: 0, tenant_access_token: "tenant-token", expire: 7200 }),
      };
    }
    return {
      ok: true,
      json: async () => ({ code: 0, data: { image_key: "img_v3_test" } }),
    };
  };

  try {
    await withApiEnvironment(async () => {
      process.env.FRONTEND_ORIGIN = "https://frontend.example";
      const token = createSessionToken(
        { userId: "ou_test", expiresAt: Date.now() + 60_000 },
        "app-secret",
      );
      const result = await main({
        headers: {
          origin: "https://frontend.example",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "register_media",
          fileId: "cloud://env-1.checklist-media/checklist-media/file.png",
          downloadUrl:
            "https://env-1.api.tcloudbasegateway.com/v1/storages/object/sign/checklist-media/checklist-media/file.png?token=ok",
          mimeType: "image/png",
          fileName: "file.png",
        }),
      });
      assert.equal(result.statusCode, 201);
      assert.equal(JSON.parse(result.body).data.imageKey, "img_v3_test");
      assert.equal(requested.length, 3);
    });
  } finally {
    global.fetch = originalFetch;
    if (originalOrigin === undefined) delete process.env.FRONTEND_ORIGIN;
    else process.env.FRONTEND_ORIGIN = originalOrigin;
  }
});

test("authentication returns the signed session expiry", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("app_access_token")) {
      return {
        ok: true,
        json: async () => ({ code: 0, app_access_token: "app-token" }),
      };
    }
    return {
      ok: true,
      json: async () => ({ code: 0, data: { open_id: "ou_test" } }),
    };
  };

  try {
    await withApiEnvironment(async () => {
      const before = Date.now();
      const result = await main({
        headers: {},
        body: JSON.stringify({ action: "authenticate", code: "auth-code" }),
      });
      const data = JSON.parse(result.body).data;
      assert.equal(result.statusCode, 200);
      assert.equal(typeof data.sessionToken, "string");
      assert.ok(data.expiresAt >= before + 14 * 60 * 1000);
    });
  } finally {
    global.fetch = originalFetch;
  }
});
