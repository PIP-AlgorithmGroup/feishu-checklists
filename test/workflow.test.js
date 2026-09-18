const test = require("node:test");
const assert = require("node:assert/strict");

const { buildCardContent } = require("../app.js");
const { parseChecklist } = require("../cloudfunctions/feishu-checklist-api/index.js");
const {
  processCallback,
  renderCard,
} = require("../cloudfunctions/feishu-card-callback/logic.js");

test("keeps checklist and media contracts intact from creation through callback refresh", async () => {
  const checklist = parseChecklist({
    id: "checklist-1",
    title: "门店检查",
    items: [
      {
        id: "item-1",
        text: "检查门头",
        images: [
          {
            fileId: "cloud://env.bucket/checklist-media/photo.png",
            imageKey: "img_v3_photo",
            width: 1200,
            height: 800,
            size: 204800,
          },
        ],
        videos: [
          {
            fileId: "cloud://env.bucket/checklist-media/walkthrough.mp4",
            fileKey: "file_v3_walkthrough",
            fileName: "walkthrough.mp4",
            duration: 8000,
          },
        ],
      },
    ],
  });
  const sentCard = buildCardContent(checklist).card;
  const refreshedCard = renderCard(checklist);

  assert.deepEqual(sentCard.body.elements, refreshedCard.body.elements);
  assert.equal(sentCard.config.enable_forward, false);
  assert.equal(refreshedCard.config.update_multi, true);

  const repository = {
    async apply(event) {
      const item = checklist.items.find((candidate) => candidate.id === event.itemId);
      item.checked = event.checked;
      return { duplicate: false, checklist };
    },
  };
  const result = await processCallback(
    {
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
          checked: true,
          value: { checklist_id: "checklist-1", item_id: "item-1" },
        },
        context: { open_message_id: "om_1", open_chat_id: "oc_1" },
      },
    },
    repository,
    { appId: "app-id", verificationToken: "verification-token" },
  );

  assert.equal(result.card.data.body.elements[1].checked, true);
  assert.equal(result.card.data.body.elements[2].img_key, "img_v3_photo");
  assert.equal(result.card.data.body.elements[2].mode, "crop_center");
  assert.equal(result.card.data.body.elements[2].compact_width, true);
  assert.equal(result.card.data.body.elements[2].preview, true);
  assert.equal(result.card.data.body.elements[3].file_key, "file_v3_walkthrough");
});
