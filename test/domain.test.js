const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { parseChecklist } = require("../src/checklist.js");
const { buildCardContent, renderCard } = require("../src/card.js");
const { parseCallback, processCallback, verifySignature, decryptPayload } = require("../src/callback.js");
const { createSessionToken, verifySessionToken } = require("../src/auth.js");
const { parseImageInput, parseVideoInput } = require("../src/media.js");
const { createSignature, validatePageUrl } = require("../src/sign.js");
const { parseBulkItems, moveItem, shouldCreateNewItem, parseTriggerCode, getClipboardMediaFiles } = require("../src/editor.js");

function checklistInput() {
  return {
    id: "checklist-1",
    title: "门店检查",
    items: [{
      id: "item-1",
      text: "检查门头",
      checked: true,
      images: [{ fileId: "/media/photo.png", imageKey: "img_v3_photo" }],
      videos: [{ fileId: "/media/video.mp4", fileKey: "file_v3_video", duration: 8000 }],
    }],
  };
}

function callbackPayload(checked = true) {
  return {
    schema: "2.0",
    header: {
      event_id: "event-1",
      event_type: "card.action.trigger",
      token: "verification-token",
      app_id: "app-id",
    },
    event: {
      action: {
        tag: "checker",
        checked,
        value: { checklist_id: "checklist-1", item_id: "item-1" },
      },
      context: { open_message_id: "om_1", open_chat_id: "oc_1" },
    },
  };
}

test("validates the checklist while preserving Feishu media keys", () => {
  const checklist = parseChecklist(checklistInput());
  assert.equal(checklist.items[0].checked, false);
  assert.equal(checklist.items[0].images[0].imageKey, "img_v3_photo");
  assert.equal(checklist.items[0].videos[0].fileKey, "file_v3_video");
  assert.throws(() => parseChecklist({ ...checklistInput(), items: [] }), /1-50/);
});

test("sends and refreshes the same checker, image and video elements", async () => {
  const checklist = parseChecklist(checklistInput());
  assert.deepEqual(buildCardContent(checklist).card.body.elements, renderCard(checklist).body.elements);
  assert.equal(buildCardContent(checklist).update_multi, true);
  assert.equal(renderCard(checklist).config.update_multi, true);
  assert.equal(renderCard(checklist).body.elements[2].img_key, "img_v3_photo");
  assert.equal(renderCard(checklist).body.elements[3].file_key, "file_v3_video");

  const result = await processCallback(callbackPayload(false), {
    async apply(event) {
      assert.equal(event.checked, false);
      assert.equal(event.openChatId, "oc_1");
      return { duplicate: false, checklist };
    },
  }, { appId: "app-id", verificationToken: "verification-token" });
  assert.equal(result.card.data.body.elements[1].checked, false);
});

test("rejects callbacks for another app or an invalid checker", () => {
  assert.throws(() => parseCallback(callbackPayload(), { appId: "other-app" }), /App ID/);
  const payload = callbackPayload();
  payload.event.action.checked = "true";
  assert.throws(() => parseCallback(payload), /checker/);
});

test("returns the stored snapshot for a duplicate event", async () => {
  const checklist = parseChecklist(checklistInput());
  const result = await processCallback(callbackPayload(true), {
    async apply() { return { duplicate: true, checklist }; },
  }, { appId: "app-id", verificationToken: "verification-token" });
  assert.equal(result.toast.content, "状态已是最新");
});

test("verifies and decrypts Feishu callback payloads", () => {
  const body = JSON.stringify(callbackPayload());
  const encryptKey = "test-encrypt-key";
  const timestamp = "123";
  const nonce = "nonce";
  const signature = crypto.createHash("sha256")
    .update(timestamp + nonce + encryptKey + body).digest("hex");
  assert.equal(verifySignature({ timestamp, nonce, encryptKey, body, signature }), true);
  assert.equal(verifySignature({ timestamp, nonce, encryptKey, body, signature: "bad" }), false);

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", crypto.createHash("sha256").update(encryptKey).digest(), iv);
  const encrypted = Buffer.concat([iv, cipher.update(body), cipher.final()]).toString("base64");
  assert.deepEqual(decryptPayload(encrypted, encryptKey), callbackPayload());
});

test("retains short-lived Feishu session verification", () => {
  const now = Date.now();
  const token = createSessionToken({ userId: "ou_1", expiresAt: now + 1000 }, "secret");
  assert.equal(verifySessionToken(token, "secret", now).userId, "ou_1");
  assert.throws(() => verifySessionToken(token, "secret", now + 1000), /过期/);
});

test("checks image and MP4 signatures before Feishu upload", () => {
  assert.equal(parseImageInput({ mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) }).extension, "png");
  assert.throws(() => parseImageInput({ mimeType: "image/png", buffer: Buffer.from("invalid") }), /不匹配/);
  const mp4 = Buffer.from([0, 0, 0, 12, 102, 116, 121, 112, 0, 0, 0, 0]);
  assert.equal(parseVideoInput({ mimeType: "video/mp4", buffer: mp4, duration: 8000 }).duration, 8000);
});

test("rejects media exceeding the Feishu file limits", () => {
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(5 * 1024 * 1024)]);
  assert.throws(() => parseImageInput({ mimeType: "image/png", buffer: png }), /5 MB/);
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 12, 102, 116, 121, 112, 0, 0, 0, 0]), Buffer.alloc(30 * 1024 * 1024)]);
  assert.throws(() => parseVideoInput({ mimeType: "video/mp4", buffer: mp4, duration: 8000 }), /30 MB/);
});

test("signs only an allowlisted HTTPS page URL", () => {
  assert.equal(validatePageUrl("https://app.example.com/editor?x=1#part", ["https://app.example.com"]), "https://app.example.com/editor?x=1");
  assert.throws(() => validatePageUrl("https://other.example.com/", ["https://app.example.com"]), /不受信任/);
  assert.match(createSignature({ ticket: "ticket", nonceStr: "nonce", timestamp: 123, url: "https://app.example.com" }), /^[0-9a-f]{40}$/);
});

test("preserves editor input, order and Feishu launch rules", () => {
  assert.deepEqual(parseBulkItems(" first \n\n second "), ["first", "second"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
  assert.equal(shouldCreateNewItem({ key: "Enter", shiftKey: true }), true);
  assert.equal(shouldCreateNewItem({ key: "Enter", shiftKey: false }), false);
  const url = new URL("https://example.com/?bdp_launch_query=" + encodeURIComponent(JSON.stringify({ trigger_id: "trigger" })));
  assert.equal(parseTriggerCode(url), "trigger");
});

test("accepts image and MP4 clipboard files only", () => {
  const file = { name: "photo.png" };
  assert.deepEqual(getClipboardMediaFiles({ items: [
    { kind: "file", type: "image/png", getAsFile: () => file },
    { kind: "string", type: "text/plain", getAsFile: () => null },
  ] }), [file]);
});
