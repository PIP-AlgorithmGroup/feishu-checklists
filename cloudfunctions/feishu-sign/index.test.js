const test = require("node:test");
const assert = require("node:assert/strict");

const { createSignature, validatePageUrl } = require("./index.js");

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
  assert.equal(
    validatePageUrl(
      "https://example.com/path?a=1",
      "https://example.com",
    ),
    "https://example.com/path?a=1",
  );
  assert.throws(
    () => validatePageUrl("https://evil.example/path", "https://example.com"),
    /不受信任/,
  );
  assert.throws(
    () => validatePageUrl("http://example.com/path", "https://example.com"),
    /HTTPS/,
  );
});
