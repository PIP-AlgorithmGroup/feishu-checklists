const test = require("node:test");
const assert = require("node:assert/strict");

const { createSessionToken, verifySessionToken } = require("./auth.js");

test("creates and verifies a short-lived signed session", () => {
  const token = createSessionToken(
    { userId: "ou_123", expiresAt: 2_000_000 },
    "app-secret",
  );

  assert.deepEqual(verifySessionToken(token, "app-secret", 1_000_000), {
    userId: "ou_123",
    expiresAt: 2_000_000,
  });
});

test("rejects a modified or expired session", () => {
  const token = createSessionToken(
    { userId: "ou_123", expiresAt: 2_000_000 },
    "app-secret",
  );

  assert.throws(() => verifySessionToken(`${token}x`, "app-secret", 1_000_000), /身份凭证无效/);
  assert.throws(() => verifySessionToken(token, "app-secret", 3_000_000), /身份凭证已过期/);
});
