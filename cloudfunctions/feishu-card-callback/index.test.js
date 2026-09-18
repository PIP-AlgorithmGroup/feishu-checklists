const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  parseCallback,
  processCallback,
  renderCard,
  verifySignature,
} = require("./logic.js");
const {
  createRepository,
  getCloudBaseApiKey,
  parseBody,
} = require("./index.js");

function callback(overrides = {}) {
  return {
    schema: "2.0",
    header: {
      event_id: "event-1",
      event_type: "card.action.trigger",
      token: "verification-token",
      app_id: "cli_test",
    },
    event: {
      action: {
        tag: "checker",
        checked: true,
        value: { checklist_id: "checklist-1", item_id: "item-1" },
      },
      context: { open_message_id: "om_1", open_chat_id: "oc_1" },
    },
    ...overrides,
  };
}

function encryptPayload(payload, encryptKey) {
  const key = crypto.createHash("sha256").update(encryptKey).digest();
  const iv = Buffer.from("0123456789abcdef", "utf8");
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, encrypted]).toString("base64");
}

test("parses checker state as an absolute boolean", () => {
  assert.deepEqual(parseCallback(callback()), {
    eventId: "event-1",
    checklistId: "checklist-1",
    itemId: "item-1",
    checked: true,
    openMessageId: "om_1",
    openChatId: "oc_1",
  });
});

test("rejects callbacks that do not belong to this app", () => {
  assert.throws(
    () =>
      parseCallback(callback(), {
        appId: "cli_other",
        verificationToken: "verification-token",
      }),
    /App ID/,
  );
});

test("renders deterministic progress and callback values", () => {
  const card = renderCard({
    id: "checklist-1",
    title: "检查清单测试",
    items: [{ id: "item-1", text: "确认测试事项", checked: true }],
  });

  assert.equal(card.schema, "2.0");
  assert.equal(card.config.enable_forward, false);
  assert.equal(card.body.elements[0].content, "**进度：1/1**");
  assert.equal(card.body.elements[1].checked, true);
  assert.deepEqual(card.body.elements[1].behaviors[0].value, {
    checklist_id: "checklist-1",
    item_id: "item-1",
  });
});

test("keeps uploaded videos when refreshing a checklist card", () => {
  const card = renderCard({
    id: "checklist-1",
    title: "门店检查",
    items: [
      {
        id: "item-1",
        text: "检查动线",
        checked: false,
        videos: [{ fileKey: "file_v3_abc" }],
      },
    ],
  });

  assert.equal(card.config.enable_forward, false);
  assert.equal(card.body.elements[2].tag, "video");
  assert.equal(card.body.elements[2].file_key, "file_v3_abc");
});

test("returns the stored state for duplicate events", async () => {
  let writes = 0;
  const repository = {
    async apply(event) {
      writes += 1;
      return {
        duplicate: writes > 1,
        checklist: {
          id: event.checklistId,
          title: "检查清单测试",
          items: [{ id: "item-1", text: "确认测试事项", checked: true }],
        },
      };
    },
  };

  const first = await processCallback(callback(), repository, {
    appId: "cli_test",
    verificationToken: "verification-token",
  });
  const second = await processCallback(callback(), repository, {
    appId: "cli_test",
    verificationToken: "verification-token",
  });

  assert.equal(first.toast.content, "状态已更新");
  assert.equal(second.toast.content, "状态已是最新");
  assert.equal(second.card.data.body.elements[1].checked, true);
});

test("verifies the raw request signature", () => {
  assert.equal(
    verifySignature({
      timestamp: "1700000000",
      nonce: "nonce",
      encryptKey: "encrypt-key",
      body: '{"hello":"world"}',
      signature: "154d31b3b082c162f692afad4f1514af58499a0ef1ea0dc283f42103270ed67e",
    }),
    true,
  );
});

test("reports the exact missing signature headers", () => {
  assert.throws(
    () =>
      parseBody(
        {
          headers: { "x-lark-request-nonce": "nonce" },
          body: '{"encrypt":"ciphertext"}',
        },
        "encrypt-key",
      ),
    /X-Lark-Request-Timestamp.*X-Lark-Signature/,
  );
});

test("distinguishes a signature digest mismatch", () => {
  assert.throws(
    () =>
      parseBody(
        {
          headers: {
            "x-lark-request-timestamp": "1700000000",
            "x-lark-request-nonce": "nonce",
            "x-lark-signature": "invalid",
          },
          body: '{"encrypt":"ciphertext"}',
        },
        "encrypt-key",
      ),
    /签名字段齐全但摘要不匹配/,
  );
});

test("decrypts an encrypted callback when CloudBase strips all signature headers", () => {
  const encryptKey = "encrypt-key";
  const payload = {
    type: "url_verification",
    token: "verification-token",
    challenge: "challenge-code",
  };

  assert.deepEqual(
    parseBody(
      {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          encrypt: encryptPayload(payload, encryptKey),
        }),
      },
      encryptKey,
    ),
    payload,
  );
});

test("rejects unsigned plaintext when encryption is configured", () => {
  assert.throws(
    () =>
      parseBody(
        {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "url_verification",
            token: "verification-token",
            challenge: "challenge-code",
          }),
        },
        "encrypt-key",
      ),
    /无签名头的明文回调/,
  );
});

test("calls the CloudBase PostgreSQL RPC with server credentials", async () => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      async json() {
        return { duplicate: false, checklist: { id: "checklist-1" } };
      },
    };
  };

  try {
    const repository = createRepository({ envId: "env-1", apiKey: "secret" });
    await repository.apply({
      eventId: "event-1",
      checklistId: "checklist-1",
      itemId: "item-1",
      checked: true,
      openMessageId: "om_1",
      openChatId: "oc_1",
    });
    assert.equal(
      request.url,
      "https://env-1.api.tcloudbasegateway.com/v1/rdb/rest/rpc/apply_checklist_event",
    );
    assert.equal(request.options.headers.authorization, "Bearer secret");
    assert.equal(JSON.parse(request.options.body).p_checked, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("prefers the officially injected CloudBase API key", () => {
  assert.equal(
    getCloudBaseApiKey({
      CLOUDBASE_APIKEY: "managed-key",
      CLOUDBASE_API_KEY: "legacy-key",
    }),
    "managed-key",
  );
  assert.equal(
    getCloudBaseApiKey({ CLOUDBASE_API_KEY: "legacy-key" }),
    "legacy-key",
  );
});

test("callback SQL rejects unknown checklists and mismatched chats", () => {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  const applyFunction = schema.slice(schema.indexOf("create or replace function public.apply_checklist_event"));

  assert.doesNotMatch(applyFunction, /insert into public\.checklists/);
  assert.match(applyFunction, /if not found then\s+raise exception '清单不存在'/i);
  assert.match(applyFunction, /v_checklist\.open_chat_id is distinct from p_open_chat_id/);
});
