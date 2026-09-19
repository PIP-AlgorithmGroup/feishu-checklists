import {
  BadRequestException, Controller, HttpCode, Post, Req, ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ChecklistService } from './checklist.service';
import { parseIncomingCallback, processCallback } from './callback';

@Controller()
export class ChecklistCallbackController {
  constructor(private readonly checklistService: ChecklistService) {}

  @Post('feishu-card-callback')
  @HttpCode(200)
  async callback(@Req() req: Request): Promise<unknown> {
    const config = {
      appId: process.env.FEISHU_APP_ID,
      verificationToken: process.env.FEISHU_VERIFICATION_TOKEN,
      encryptKey: process.env.FEISHU_ENCRYPT_KEY,
    };
    if (!config.appId || !config.verificationToken || !config.encryptKey) {
      throw new ServiceUnavailableException('飞书回调配置不完整');
    }
    let payload: unknown;
    try {
      payload = parseIncomingCallback(req.body, req.headers, config);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '飞书回调无效');
    }
    if (payload !== null && typeof payload === 'object' &&
        'challenge' in payload) return payload;
    return processCallback(payload, this.checklistService, config);
  }
}
