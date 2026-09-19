const crypto = require("node:crypto");

function createSignature({ ticket, nonceStr, timestamp, url }) {
  const source =
    `jsapi_ticket=${ticket}` +
    `&noncestr=${nonceStr}` +
    `&timestamp=${timestamp}` +
    `&url=${url}`;
  return crypto.createHash("sha1").update(source).digest("hex");
}

function validatePageUrl(value, allowedOrigins) {
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

module.exports = { createSignature, validatePageUrl };
