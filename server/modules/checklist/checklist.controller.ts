import { BadRequestException, Body, Controller, Get, Header, Post, Query, Req, StreamableFile } from '@nestjs/common';
import { CanRole, NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { CHECKLIST_ADMIN_ROLE } from '../../../shared/api.interface';
import type { Request } from 'express';
import type {
  ChecklistDraft, ChecklistListResponse, CreateChecklistResponse, JsapiSignResponse,
  MediaRegistrationInput, MediaRegistrationResponse,
  ChecklistMessageBinding,
  ConversationNameInput,
  AdminChecklistListResponse, AdminChecklistFilters, ChecklistImageRequest,
} from '../../../shared/api.interface';
import { parseChecklist } from './checklist';
import { ChecklistService } from './checklist.service';
import { FeishuApiService } from './feishu-api';
import { parseAdminQuery } from './admin-query';

@Controller('api/checklist')
export class ChecklistController {
  constructor(
    private readonly checklistService: ChecklistService,
    private readonly feishuApiService: FeishuApiService,
  ) {}

  @NeedLogin()
  @Get()
  async list(
    @Query('page') page: string | undefined,
    @Query('search') search: string | undefined,
    @Req() req: Request,
  ): Promise<ChecklistListResponse> {
    const pageNumber: number = page === undefined ? 1 : Number(page);
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 100000) {
      throw new BadRequestException('页码必须是 1-100000 的整数');
    }
    if (search && search.length > 80) throw new BadRequestException('搜索内容不能超过 80 字');
    const result: ChecklistListResponse = await this.checklistService.list(
      req.userContext.userId, pageNumber, search?.trim() ?? '',
    );
    const names: Map<string, string | null> = await this.feishuApiService.getChatNames(
      result.items.flatMap((record) => record.conversation ? [record.conversation.chatId] : []),
    );
    for (const record of result.items) {
      if (record.conversation) {
        record.conversation.name = names.get(record.conversation.chatId) ?? record.conversation.name;
      }
    }
    return result;
  }

  @NeedLogin()
  @CanRole([CHECKLIST_ADMIN_ROLE])
  @Get('admin')
  async listAdmin(@Query() query: Record<string, unknown>): Promise<AdminChecklistListResponse> {
    let filters: AdminChecklistFilters;
    try {
      filters = parseAdminQuery(query);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '筛选条件无效');
    }
    const result: AdminChecklistListResponse = await this.checklistService.listAdmin(filters);
    const names: Map<string, string | null> = await this.feishuApiService.getChatNames(
      result.items.flatMap((record) => record.conversation ? [record.conversation.chatId] : []),
    );
    for (const record of result.items) {
      if (record.conversation) {
        record.conversation.name = names.get(record.conversation.chatId) ?? record.conversation.name;
      }
    }
    return result;
  }

  @NeedLogin()
  @Get('image')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async image(@Query() query: ChecklistImageRequest, @Req() req: Request): Promise<StreamableFile> {
    return this.readImage(query, req.userContext.userId);
  }

  @NeedLogin()
  @CanRole([CHECKLIST_ADMIN_ROLE])
  @Get('admin/image')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async adminImage(@Query() query: ChecklistImageRequest): Promise<StreamableFile> {
    return this.readImage(query);
  }

  private async readImage(query: ChecklistImageRequest, userId?: string): Promise<StreamableFile> {
    if (typeof query.checklistId !== 'string' || !query.checklistId || query.checklistId.length > 100 ||
        typeof query.imageKey !== 'string' || !query.imageKey || query.imageKey.length > 200) {
      throw new BadRequestException('清单或图片标识无效');
    }
    await this.checklistService.requireImage(query.checklistId, query.imageKey, userId);
    const image: { buffer: Buffer; mimeType: string } = await this.feishuApiService.downloadImage(query.imageKey);
    return new StreamableFile(image.buffer, { type: image.mimeType, disposition: 'inline' });
  }

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

  @NeedLogin()
  @Post('message-binding')
  async bindMessage(@Body() input: unknown, @Req() req: Request): Promise<{ bound: true }> {
    if (typeof input !== 'object' || input === null ||
        !('checklistId' in input) || typeof input.checklistId !== 'string' ||
        !input.checklistId || input.checklistId.length > 100 ||
        !('openChatId' in input) || typeof input.openChatId !== 'string' ||
        !/^oc_[a-zA-Z0-9]{1,100}$/.test(input.openChatId) ||
        !('openMessageId' in input) || typeof input.openMessageId !== 'string' ||
        !/^om_[a-zA-Z0-9]{1,100}$/.test(input.openMessageId)) {
      throw new BadRequestException('发送回执缺少有效的清单、对话或消息标识');
    }
    const binding: ChecklistMessageBinding = {
      checklistId: input.checklistId, openChatId: input.openChatId, openMessageId: input.openMessageId,
    };
    await this.checklistService.bindMessage(binding, req.userContext.userId);
    return { bound: true };
  }

  @NeedLogin()
  @Post('conversation-name')
  async saveConversationName(@Body() input: unknown, @Req() req: Request): Promise<{ saved: true }> {
    if (typeof input !== 'object' || input === null ||
        !('chatId' in input) || typeof input.chatId !== 'string' ||
        !/^oc_[a-zA-Z0-9]{1,100}$/.test(input.chatId) ||
        !('name' in input) || typeof input.name !== 'string' ||
        !input.name.trim() || input.name.length > 200) {
      throw new BadRequestException('对话标识或名称无效');
    }
    const name: ConversationNameInput = { chatId: input.chatId, name: input.name.trim() };
    await this.checklistService.saveConversationName(name, req.userContext.userId);
    return { saved: true };
  }
}
