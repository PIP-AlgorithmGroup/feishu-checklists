import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

@Controller('feishu-probe')
export class CallbackProbeController {
  @Post()
  probe(@Body() body: unknown, @Req() request: Request): {
    challenge: string;
    rawBodyAvailable: boolean;
  } {
    const valid: boolean = typeof body === 'object' && body !== null &&
      'challenge' in body && body.challenge === 'probe';
    return {
      challenge: valid ? 'probe-ok' : 'invalid-probe',
      rawBodyAvailable: 'rawBody' in request && Buffer.isBuffer(request.rawBody),
    };
  }
}
