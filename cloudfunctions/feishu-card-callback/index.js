const {
  decryptPayload,
  processCallback,
  verifySignature,
} = require("./logic.js");

function createRepository({ envId, apiKey }) {
  const endpoint =
    `https://${envId}.api.tcloudbasegateway.com` +
    "/v1/rdb/rest/rpc/apply_checklist_event";
  return {
    async apply(event) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          p_event_id: event.eventId,
          p_checklist_id: event.checklistId,
          p_item_id: event.itemId,
          p_checked: event.checked,
          p_open_message_id: event.openMessageId,
          p_open_chat_id: event.openChatId,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          `数据库 RPC 失败：${response.status} ${payload.message || payload.msg || ""}`.trim(),
        );
      }
      return payload;
    },
  };
}

function getCloudBaseApiKey(env = process.env) {
  return env.CLOUDBASE_APIKEY || env.CLOUDBASE_API_KEY;
}

function header(headers, name) {
  const entry = Object.entries(headers || {}).find(
    ([key]) => key.toLowerCase() === name,
  );
  return entry?.[1];
}

function parseBody(event, encryptKey) {
  let rawBody =
    typeof event.body === "string"
      ? event.body
      : JSON.stringify(event.body || {});
  if (event.isBase64Encoded) {
    rawBody = Buffer.from(rawBody, "base64").toString("utf8");
  }

  const payload = JSON.parse(rawBody);

  if (encryptKey) {
    const signatureFields = {
      "X-Lark-Request-Timestamp": header(
        event.headers,
        "x-lark-request-timestamp",
      ),
      "X-Lark-Request-Nonce": header(event.headers, "x-lark-request-nonce"),
      "X-Lark-Signature": header(event.headers, "x-lark-signature"),
    };
    const missingHeaders = Object.entries(signatureFields)
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missingHeaders.length === 3) {
      if (!payload.encrypt) {
        throw new Error("CloudBase 网关收到无签名头的明文回调");
      }
      return decryptPayload(payload.encrypt, encryptKey);
    }
    if (missingHeaders.length > 0) {
      throw new Error(
        `飞书回调缺少签名请求头：${missingHeaders.join(", ")}`,
      );
    }

    const valid = verifySignature({
      timestamp: signatureFields["X-Lark-Request-Timestamp"],
      nonce: signatureFields["X-Lark-Request-Nonce"],
      signature: signatureFields["X-Lark-Signature"],
      encryptKey,
      body: rawBody,
    });
    if (!valid) throw new Error("飞书回调签名字段齐全但摘要不匹配");
  }

  return payload.encrypt ? decryptPayload(payload.encrypt, encryptKey) : payload;
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

exports.main = async (event) => {
  try {
    const appId = process.env.FEISHU_APP_ID;
    const verificationToken = process.env.FEISHU_VERIFICATION_TOKEN;
    const encryptKey = process.env.FEISHU_ENCRYPT_KEY || "";
    const envId = process.env.CLOUDBASE_ENV_ID;
    const apiKey = getCloudBaseApiKey();
    if (!appId || !verificationToken || !envId || !apiKey) {
      throw new Error("云函数缺少飞书回调或数据库环境变量");
    }

    const payload = parseBody(event, encryptKey);
    if (payload.type === "url_verification") {
      if (payload.token !== verificationToken) {
        throw new Error("URL 校验 Token 不匹配");
      }
      return response(200, { challenge: payload.challenge });
    }

    const result = await processCallback(
      payload,
      createRepository({ envId, apiKey }),
      { appId, verificationToken },
    );
    return response(200, result);
  } catch (error) {
    console.error("feishu-card-callback failed:", error.message);
    return response(400, { code: 400, message: error.message });
  }
};

exports.createRepository = createRepository;
exports.getCloudBaseApiKey = getCloudBaseApiKey;
exports.parseBody = parseBody;
