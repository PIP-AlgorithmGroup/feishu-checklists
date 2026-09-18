const crypto = require("node:crypto");

const TOKEN_URL =
  "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
const TICKET_URL = "https://open.feishu.cn/open-apis/jssdk/ticket/get";

let tokenCache = null;
let ticketCache = null;

function getAllowedOrigins() {
  const value = process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN || "";
  const origins = value.split(",").map((origin) => origin.trim()).filter(Boolean);
  if (!origins.length) throw new Error("云函数缺少 FRONTEND_ORIGINS 环境变量");
  if (origins.some((origin) => {
    try {
      const url = new URL(origin);
      return url.protocol !== "https:" || url.origin !== origin;
    } catch {
      return true;
    }
  })) throw new Error("FRONTEND_ORIGINS 必须是 HTTPS origin，且不带路径或结尾斜杠");
  return origins;
}

function createSignature({ ticket, nonceStr, timestamp, url }) {
  const source =
    `jsapi_ticket=${ticket}` +
    `&noncestr=${nonceStr}` +
    `&timestamp=${timestamp}` +
    `&url=${url}`;
  return crypto.createHash("sha1").update(source).digest("hex");
}

function validatePageUrl(value, allowedOrigins = getAllowedOrigins()) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("页面 URL 无效");
  }
  if (url.protocol !== "https:") throw new Error("页面 URL 必须使用 HTTPS");
  if (!allowedOrigins.includes(url.origin)) throw new Error("页面 URL 来自不受信任的域名");
  return value.split("#", 1)[0];
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(
      `飞书接口失败：${payload.code ?? response.status} ${payload.msg || ""}`.trim(),
    );
  }
  return payload;
}

async function getTenantAccessToken(appId, appSecret) {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.value;
  const payload = await requestJson(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  tokenCache = {
    value: payload.tenant_access_token,
    expiresAt: Date.now() + (payload.expire - 60) * 1000,
  };
  return tokenCache.value;
}

async function getJsapiTicket(appId, appSecret) {
  if (ticketCache && ticketCache.expiresAt > Date.now()) return ticketCache.value;
  const token = await getTenantAccessToken(appId, appSecret);
  const payload = await requestJson(TICKET_URL, {
    headers: { authorization: `Bearer ${token}` },
  });
  ticketCache = {
    value: payload.data.ticket,
    expiresAt: Date.now() + (payload.data.expire_in - 60) * 1000,
  };
  return ticketCache.value;
}

function json(statusCode, body, origin) {
  return {
    statusCode,
    headers: {
      ...(origin ? { "access-control-allow-origin": origin } : {}),
      "access-control-allow-methods": "GET,OPTIONS",
      "content-type": "application/json; charset=utf-8",
      vary: "Origin",
    },
    body: JSON.stringify(body),
  };
}

exports.main = async (event) => {
  const method = event.httpMethod || event.requestContext?.http?.method || "GET";
  const origin = event.headers?.origin || event.headers?.Origin || "";
  let responseOrigin;
  try {
    const allowedOrigins = getAllowedOrigins();
    if (origin && !allowedOrigins.includes(origin)) {
      return json(403, { code: 403, message: "请求来源不允许" });
    }
    responseOrigin = origin || allowedOrigins[0];
    if (method === "OPTIONS") return json(204, {}, responseOrigin);
    if (method !== "GET") {
      return json(405, { code: 405, message: "仅支持 GET" }, responseOrigin);
    }

    const appId = process.env.FEISHU_APP_ID;
    const appSecret = process.env.FEISHU_APP_SECRET;
    if (!appId || !appSecret) throw new Error("云函数缺少飞书应用环境变量");

    const url = validatePageUrl(event.queryStringParameters?.url, allowedOrigins);
    const ticket = await getJsapiTicket(appId, appSecret);
    const timestamp = Date.now();
    const nonceStr = crypto.randomBytes(16).toString("hex");
    const signature = createSignature({ ticket, nonceStr, timestamp, url });
    return json(200, {
      code: 0,
      data: { appId, timestamp, nonceStr, signature },
    }, responseOrigin);
  } catch (error) {
    console.error("feishu-sign failed:", error.message);
    return json(400, { code: 400, message: error.message }, responseOrigin);
  }
};

exports.createSignature = createSignature;
exports.validatePageUrl = validatePageUrl;
