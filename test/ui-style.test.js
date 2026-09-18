const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("shows the full per-file upload error in a narrow sidebar", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const rule = html.match(/\.upload-error \.upload-state\s*\{([^}]+)\}/)?.[1] || "";

  assert.match(rule, /white-space:\s*normal/);
  assert.match(rule, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(rule, /text-overflow:\s*ellipsis/);
});
