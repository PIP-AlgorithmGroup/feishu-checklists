function parseChecklist(input) {
  if (!input || typeof input !== "object") throw new Error("请求缺少清单数据");
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!id || id.length > 100) throw new Error("清单标识无效");
  if (!title || title.length > 80) throw new Error("清单标题长度应为 1-80 个字符");
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 50) {
    throw new Error("清单事项数量应为 1-50 项");
  }

  const ids = new Set();
  const items = input.items.map((item) => {
    const itemId = typeof item?.id === "string" ? item.id.trim() : "";
    const text = typeof item?.text === "string" ? item.text.trim() : "";
    if (!itemId || itemId.length > 100) throw new Error("事项标识无效");
    if (ids.has(itemId)) throw new Error("事项标识重复");
    if (!text || text.length > 500) throw new Error("事项内容长度应为 1-500 个字符");
    ids.add(itemId);
    const images = Array.isArray(item.images) ? item.images : [];
    if (images.length > 3) throw new Error("每个事项最多添加 3 张图片");
    const normalizedImages = images.map((image) => {
      if (!image?.imageKey) throw new Error("事项图片标识无效");
      return {
        fileId: image.fileId || null,
        imageKey: image.imageKey,
        width: Number(image.width) || null,
        height: Number(image.height) || null,
        size: Number(image.size) || null,
      };
    });
    const videos = Array.isArray(item.videos) ? item.videos : [];
    if (videos.length > 3) throw new Error("每个事项最多添加 3 个视频");
    const normalizedVideos = videos.map((video) => {
      if (!video?.fileKey) throw new Error("事项视频标识无效");
      return {
        fileId: video.fileId || null,
        fileKey: video.fileKey,
        fileName: video.fileName || "video.mp4",
        duration: Number(video.duration) || null,
      };
    });
    return {
      id: itemId,
      text,
      checked: false,
      images: normalizedImages,
      videos: normalizedVideos,
    };
  });

  return { id, title, items };
}

module.exports = { parseChecklist };
