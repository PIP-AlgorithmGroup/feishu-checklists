const crypto = require("node:crypto");

function signature(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function createSessionToken(session, secret) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

function verifySessionToken(token, secret, now = Date.now()) {
  const [payload, suppliedSignature, extra] = String(token || "").split(".");
  if (!payload || !suppliedSignature || extra) throw new Error("身份凭证无效");
  const expectedSignature = signature(payload, secret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    throw new Error("身份凭证无效");
  }
  const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!session.userId || !session.expiresAt) throw new Error("身份凭证无效");
  if (session.expiresAt <= now) throw new Error("身份凭证已过期");
  return session;
}

async function getAppAccessToken({ appId, appSecret }) {
  const response = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    },
  );
  const payload = await response.json();
  if (!response.ok || payload.code !== 0 || !payload.app_access_token) {
    throw new Error(`获取飞书 app_access_token 失败：${payload.msg || response.status}`);
  }
  return payload.app_access_token;
}

async function exchangeAuthorizationCode(code, config) {
  if (!code || typeof code !== "string") throw new Error("缺少飞书授权码");
  const appAccessToken = await getAppAccessToken(config);
  const response = await fetch("https://open.feishu.cn/open-apis/authen/v1/access_token", {
    method: "POST",
    headers: {
      authorization: `Bearer ${appAccessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ grant_type: "authorization_code", code }),
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0 || !payload.data?.open_id) {
    throw new Error(`飞书用户身份校验失败：${payload.msg || response.status}`);
  }
  const expiresAt = Date.now() + 15 * 60 * 1000;
  return {
    sessionToken: createSessionToken(
      { userId: payload.data.open_id, expiresAt },
      config.appSecret,
    ),
    expiresAt,
  };
}

module.exports = {
  createSessionToken,
  exchangeAuthorizationCode,
  verifySessionToken,
};
