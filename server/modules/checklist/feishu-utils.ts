import { createHash } from 'node:crypto';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 30 * 1024 * 1024;

export function createJsapiSignature(input: {
  ticket: string; nonceStr: string; timestamp: number; url: string;
}): string {
  const source = `jsapi_ticket=${input.ticket}&noncestr=${input.nonceStr}` +
    `&timestamp=${input.timestamp}&url=${input.url}`;
  return createHash('sha1').update(source).digest('hex');
}

export function parseMiaodaFileReference(
  value: string, appId: string,
): { bucketId: string; filePath: string } {
  const escapedAppId: string = appId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match: RegExpMatchArray | null = value.match(new RegExp(
    `^(?:/spark)?/app/${escapedAppId}/runtime/api/v1/storage/object/([^/]+)/(.+)$`,
  ));
  if (!match) throw new Error('妙搭文件地址无效');
  let filePath: string;
  try {
    filePath = decodeURIComponent(match[2]);
  } catch {
    throw new Error('妙搭文件地址无效');
  }
  if (!match[1] || !filePath || filePath.includes('..')) throw new Error('妙搭文件地址无效');
  return { bucketId: match[1], filePath };
}

export function parseMiaodaOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('妙搭线上地址无效'); }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.feishuapp.com') ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('妙搭线上地址无效');
  }
  return url.origin;
}

export function validateImageBytes(buffer: Buffer, mimeType: string): 'jpg' | 'png' | 'webp' {
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('处理后的单张图片不能超过 5 MB');
  const formats = {
    'image/jpeg': { extension: 'jpg' as const, valid: buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
    'image/png': { extension: 'png' as const, valid: buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
    'image/webp': { extension: 'webp' as const, valid: buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP' },
  };
  const format: { extension: 'jpg' | 'png' | 'webp'; valid: boolean } | undefined =
    formats[mimeType as keyof typeof formats];
  if (!format) throw new Error('仅支持 JPG、PNG 和 WebP 图片');
  if (!format.valid) throw new Error('文件内容与图片类型不匹配');
  return format.extension;
}

export function validateVideoBytes(buffer: Buffer, mimeType: string): void {
  if (mimeType !== 'video/mp4') throw new Error('仅支持 MP4 视频');
  if (buffer.length > MAX_VIDEO_BYTES) throw new Error('单个视频不能超过 30 MB');
  if (buffer.length < 12 || buffer.subarray(4, 8).toString('ascii') !== 'ftyp') {
    throw new Error('文件内容与 MP4 格式不匹配');
  }
}

export { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES };
