const test = require("node:test");
const assert = require("node:assert/strict");

const { createSignature, validatePageUrl, main } = require("./index.js");

test("creates the expected lowercase SHA-1 signature", () => {
  assert.equal(
    createSignature({
      ticket: "ticket",
      nonceStr: "nonce",
      timestamp: 1234567890000,
      url: "https://example.com/path?a=1",
    }),
    "41b96a9cb64df3b3865beeeab0df25e3a807a4d0",
  );
});

test("accepts only HTTPS pages on the configured origin", () => {
  const origins = ["https://old.example", "https://new.example"];
  assert.equal(
    validatePageUrl(
      "https://new.example/path?a=1",
      origins,
    ),
    "https://new.example/path?a=1",
  );
  assert.throws(
    () => validatePageUrl("https://evil.example/path", origins),
    /不受信任/,
  );
  assert.throws(
    () => validatePageUrl("http://new.example/path", origins),
    /HTTPS/,
  );
});

test("uses configured origins for signature CORS preflight", async () => {
  const previous = process.env.FRONTEND_ORIGINS;
  process.env.FRONTEND_ORIGINS = "https://old.example, https://new.example";
  try {
    for (const origin of ["https://old.example", "https://new.example"]) {
      const result = await main({ httpMethod: "OPTIONS", headers: { origin } });
      assert.equal(result.statusCode, 204);
      assert.equal(result.headers["access-control-allow-origin"], origin);
    }
    const rejected = await main({
      httpMethod: "OPTIONS",
      headers: { origin: "https://evil.example" },
    });
    assert.equal(rejected.statusCode, 403);
    assert.equal(rejected.headers["access-control-allow-origin"], undefined);
  } finally {
    if (previous === undefined) delete process.env.FRONTEND_ORIGINS;
    else process.env.FRONTEND_ORIGINS = previous;
  }
});

test("does not trust an implicit origin when configuration is missing", async () => {
  const previousOrigins = process.env.FRONTEND_ORIGINS;
  const previousOrigin = process.env.FRONTEND_ORIGIN;
  delete process.env.FRONTEND_ORIGINS;
  delete process.env.FRONTEND_ORIGIN;
  try {
    const result = await main({ httpMethod: "OPTIONS" });
    assert.equal(result.statusCode, 400);
    assert.match(JSON.parse(result.body).message, /FRONTEND_ORIGINS/);
  } finally {
    if (previousOrigins === undefined) delete process.env.FRONTEND_ORIGINS;
    else process.env.FRONTEND_ORIGINS = previousOrigins;
    if (previousOrigin === undefined) delete process.env.FRONTEND_ORIGIN;
    else process.env.FRONTEND_ORIGIN = previousOrigin;
  }
});
