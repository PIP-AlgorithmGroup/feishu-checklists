import { BadRequestException, Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import type {
  ChecklistDraft, CreateChecklistResponse, JsapiSignResponse,
  MediaRegistrationInput, MediaRegistrationResponse,
} from '../../../shared/api.interface';
import { parseChecklist } from './checklist';
import { ChecklistService } from './checklist.service';
import { FeishuApiService } from './feishu-api';

@Controller('api/checklist')
export class ChecklistController {
  constructor(
    private readonly checklistService: ChecklistService,
    private readonly feishuApiService: FeishuApiService,
  ) {}

  @NeedLogin()
  @Get('jsapi-sign')
  sign(@Query('url') url: string): Promise<JsapiSignResponse> {
    return this.feishuApiService.sign(url);
  }

  @NeedLogin()
  @Post('media')
  registerMedia(
    @Body() input: MediaRegistrationInput, @Req() req: Request,
  ): Promise<MediaRegistrationResponse> {
    return this.feishuApiService.registerMedia(input, req);
  }

  @NeedLogin()
  @Post()
  async create(@Body() input: unknown, @Req() req: Request): Promise<CreateChecklistResponse> {
    let draft: ChecklistDraft;
    try {
      draft = parseChecklist(input);
    } catch (error) {
      if (error instanceof Error) throw new BadRequestException(error.message);
      throw error;
    }
    return this.checklistService.create(draft, req.userContext.userId);
  }
}
