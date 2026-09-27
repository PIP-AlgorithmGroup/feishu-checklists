import { randomBytes } from 'node:crypto';
import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import type { MediaRegistrationInput, MediaRegistrationResponse, JsapiSignResponse } from '../../../shared/api.interface';
import {
  createJsapiSignature, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES,
  parseMiaodaFileReference, parseMiaodaOrigin, validateImageBytes, validateVideoBytes,
} from './feishu-utils';

const TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const TICKET_URL = 'https://open.feishu.cn/open-apis/jssdk/ticket/get';
const IMAGE_URL = 'https://open.feishu.cn/open-apis/im/v1/images';
const FILE_URL = 'https://open.feishu.cn/open-apis/im/v1/files';

interface CachedValue { value: string; expiresAt: number }
let tokenCache: CachedValue | null = null;
let ticketCache: CachedValue | null = null;

function requiredConfig(name: string): string {
  const value: string = process.env[name]?.trim() ?? '';
  if (!value) throw new Error(`缺少 ${name} 环境变量`);
  return value;
}

async function feishuJson(url: string, options: RequestInit): Promise<Record<string, any>> {
  const response: Response = await fetch(url, options);
  const payload: Record<string, any> = await response.json() as Record<string, any>;
  if (!response.ok || payload.code !== 0) {
    throw new Error(`飞书接口失败：${payload.msg || response.status}`);
  }
  return payload;
}

async function getTenantAccessToken(signal?: AbortSignal): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const payload = await feishuJson(TOKEN_URL, {
    method: 'POST', signal, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app_id: requiredConfig('FEISHU_APP_ID'), app_secret: requiredConfig('FEISHU_APP_SECRET') }),
  });
  tokenCache = { value: payload.tenant_access_token, expiresAt: Date.now() + Number(payload.expire ?? 7200) * 1000 };
  return tokenCache.value;
}

async function getJsapiTicket(): Promise<string> {
  if (ticketCache && ticketCache.expiresAt > Date.now() + 60_000) return ticketCache.value;
  const token: string = await getTenantAccessToken();
  const payload = await feishuJson(TICKET_URL, { headers: { authorization: `Bearer ${token}` } });
  ticketCache = { value: payload.data.ticket, expiresAt: Date.now() + Number(payload.data.expire_in ?? 7200) * 1000 };
  return ticketCache.value;
}

function validateSignUrl(value: string, appId: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('页面 URL 无效'); }
  const local: boolean = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  const online: boolean = url.protocol === 'https:' && url.hostname.endsWith('.feishuapp.com');
  if ((!local && !online) || !url.pathname.startsWith(`/app/${appId}`)) {
    throw new Error('页面 URL 来自不受信任的地址');
  }
  url.hash = '';
  return url.toString();
}

function cleanFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'video.mp4';
}

@Injectable()
export class FeishuApiService {
  private readonly logger: Logger = new Logger(FeishuApiService.name);
  private readonly chatNames: Map<string, { name: string | null; expiresAt: number }> = new Map();

  async getChatNames(chatIds: string[]): Promise<Map<string, string | null>> {
    const result: Map<string, string | null> = new Map();
    const pending: string[] = [];
    for (const chatId of new Set(chatIds)) {
      const cached = this.chatNames.get(chatId);
      if (cached && cached.expiresAt > Date.now()) result.set(chatId, cached.name);
      else pending.push(chatId);
    }
    if (!pending.length) return result;
    let token: string;
    try {
      token = await getTenantAccessToken(AbortSignal.timeout(3000));
    } catch (error) {
      this.logger.warn(`读取所属对话失败：${error instanceof Error ? error.message : '飞书鉴权失败'}`);
      for (const chatId of pending) result.set(chatId, null);
      return result;
    }
    await Promise.all(pending.map(async (chatId: string) => {
      let name: string | null = null;
      try {
        const payload = await feishuJson(
          `https://open.feishu.cn/open-apis/im/v1/chats/${encodeURIComponent(chatId)}`,
          { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) },
        );
        name = typeof payload.data?.name === 'string' ? payload.data.name.trim() || null : null;
      } catch (error) {
        this.logger.warn(`读取所属对话名称失败：${error instanceof Error ? error.message : '飞书接口失败'}`);
      }
      result.set(chatId, name);
      if (this.chatNames.size >= 100) {
        const oldest: string | undefined = this.chatNames.keys().next().value;
        if (oldest) this.chatNames.delete(oldest);
      }
      this.chatNames.set(chatId, { name, expiresAt: Date.now() + (name ? 300000 : 30000) });
    }));
    return result;
  }

  async sign(pageUrl: string): Promise<JsapiSignResponse> {
    try {
      const appId: string = requiredConfig('MIAODA_APP_ID');
      const url: string = validateSignUrl(pageUrl, appId);
      const timestamp: number = Date.now();
      const nonceStr: string = randomBytes(16).toString('hex');
      const ticket: string = await getJsapiTicket();
      return {
        appId: requiredConfig('FEISHU_APP_ID'), timestamp, nonceStr,
        signature: createJsapiSignature({ ticket, nonceStr, timestamp, url }),
      };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '签名失败');
    }
  }

  async registerMedia(
    input: MediaRegistrationInput, req: Request,
  ): Promise<MediaRegistrationResponse> {
    try {
      const appId: string = requiredConfig('MIAODA_APP_ID');
      parseMiaodaFileReference(input.downloadUrl, appId);
      const origin: string = parseMiaodaOrigin(requiredConfig('MIAODA_PUBLIC_ORIGIN'));
      const response: Response = await fetch(new URL(input.downloadUrl, origin), {
        headers: {
          ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
          ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
        },
      });
      if (!response.ok) throw new Error(`读取妙搭文件失败：HTTP ${response.status}`);
      const declaredSize: number = Number(response.headers.get('content-length') ?? 0);
      const maxBytes: number = input.mimeType === 'video/mp4' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
      if (declaredSize > maxBytes) throw new Error('媒体文件超过大小限制');
      const buffer: Buffer = Buffer.from(await response.arrayBuffer());
      const token: string = await getTenantAccessToken();
      const form: FormData = new FormData();
      if (input.mimeType === 'video/mp4') {
        validateVideoBytes(buffer, input.mimeType);
        const duration: number = Math.round(Number(input.duration));
        if (!Number.isFinite(duration) || duration < 1) throw new Error('视频时长无效');
        const fileName: string = cleanFileName(input.fileName ?? 'video.mp4');
        form.append('file_type', 'mp4');
        form.append('file_name', fileName);
        form.append('duration', String(duration));
        form.append('file', new Blob([Uint8Array.from(buffer)], { type: input.mimeType }), fileName);
        const payload = await feishuJson(FILE_URL, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
        return { type: 'video', fileId: input.fileId, fileKey: payload.data.file_key, fileName, duration };
      }
      const extension: string = validateImageBytes(buffer, input.mimeType);
      form.append('image_type', 'message');
      form.append('image', new Blob([Uint8Array.from(buffer)], { type: input.mimeType }), `image.${extension}`);
      const payload = await feishuJson(IMAGE_URL, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
      return { type: 'image', fileId: input.fileId, imageKey: payload.data.image_key };
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadRequestException(error instanceof Error ? error.message : '媒体上传失败');
    }
  }
}
