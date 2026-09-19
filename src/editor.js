function parseTriggerCode(url) {
  const raw = url.searchParams.get("bdp_launch_query");
  if (!raw) return null;
  try {
    const launchQuery = JSON.parse(raw);
    return launchQuery.trigger_id || launchQuery.__trigger_id__ || null;
  } catch {
    return null;
  }
}

function parseBulkItems(value) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function moveItem(items, fromIndex, toIndex) {
  if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) {
    return [...items];
  }
  const result = [...items];
  const [item] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, item);
  return result;
}

function shouldCreateNewItem(event) {
  return event.key === "Enter" && event.shiftKey;
}

function getClipboardMediaFiles(clipboardData) {
  return [...(clipboardData?.items || [])]
    .filter((item) => item.kind === "file" && (item.type.startsWith("image/") || item.type === "video/mp4"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
}

module.exports = {
  getClipboardMediaFiles,
  moveItem,
  parseBulkItems,
  parseTriggerCode,
  shouldCreateNewItem,
};
