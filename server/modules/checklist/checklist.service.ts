import {
  ConflictException, Inject, Injectable, NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { checklist } from '../../database/schema';
import type {
  ChecklistDraft,
  ChecklistListResponse,
  ChecklistMessageBinding,
  ConversationNameInput,
  CreateChecklistResponse,
  ChecklistRecord, AdminChecklistFilters, AdminChecklistListResponse,
} from '../../../shared/api.interface';
import {
  type ChecklistEvent,
  matchesChecklistDraft,
  parseStoredChecklist,
  updateChecklistItem,
} from './checklist';

@Injectable()
export class ChecklistService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async list(userId: string, page: number, search: string): Promise<ChecklistListResponse> {
    if (!userId) throw new UnauthorizedException('请先登录');
    const pageSize: number = 20;
    const conditions = and(
      eq(checklist.createdBy, userId),
      search ? ilike(checklist.title, `%${search.replace(/[\\%_]/g, '\\$&')}%`) : undefined,
    );
    const totals: { total: number }[] = await this.db.select({ total: count() })
      .from(checklist).where(conditions);
    const rows: (typeof checklist.$inferSelect)[] = await this.db.select().from(checklist)
      .where(conditions).orderBy(desc(checklist.updatedAt), desc(checklist.id))
      .limit(pageSize).offset((page - 1) * pageSize);
    return {
      items: rows.map((row: typeof checklist.$inferSelect) => this.toRecord(row)),
      total: totals[0].total, page, pageSize,
    };
  }

  async listAdmin(filters: AdminChecklistFilters): Promise<AdminChecklistListResponse> {
    const pattern = (value: string): string => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
    const unfinished = sql`exists (select 1 from jsonb_array_elements(${checklist.items}) as item
      where item->>'checked' is distinct from 'true')`;
    const conditions = and(
      filters.creatorId ? eq(checklist.createdBy, filters.creatorId) : undefined,
      filters.search ? ilike(checklist.title, pattern(filters.search)) : undefined,
      filters.conversation ? or(ilike(checklist.conversationName, pattern(filters.conversation)),
        ilike(checklist.openChatId, pattern(filters.conversation))) : undefined,
      filters.status === 'active' ? unfinished :
        filters.status === 'completed' ? sql`not ${unfinished}` : undefined,
    );
    const pageSize: number = 20;
    const totals: { total: number }[] = await this.db.select({ total: count() }).from(checklist).where(conditions);
    const rows: (typeof checklist.$inferSelect)[] = await this.db.select().from(checklist)
      .where(conditions).orderBy(desc(checklist.updatedAt), desc(checklist.id))
      .limit(pageSize).offset((filters.page - 1) * pageSize);
    return { items: rows.map((row: typeof checklist.$inferSelect) => ({
      ...this.toRecord(row), createdBy: row.createdBy,
    })), total: totals[0].total, page: filters.page, pageSize };
  }

  private toRecord(row: typeof checklist.$inferSelect): ChecklistRecord {
    return {
      ...parseStoredChecklist({ id: row.checklistKey, title: row.title, items: row.items }),
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      boundToMessage: Boolean(row.openMessageId),
      conversation: row.openChatId ? { chatId: row.openChatId, name: row.conversationName ?? null,
        url: `https://applink.feishu.cn/client/chat/open?openChatId=${encodeURIComponent(row.openChatId)}`,
      } : null,
    };
  }

  async requireImage(checklistId: string, imageKey: string, userId?: string): Promise<void> {
    if (userId !== undefined && !userId) throw new UnauthorizedException('请先登录');
    const rows: (typeof checklist.$inferSelect)[] = await this.db.select().from(checklist)
      .where(and(eq(checklist.checklistKey, checklistId),
        userId !== undefined ? eq(checklist.createdBy, userId) : undefined));
    const row: typeof checklist.$inferSelect | undefined = rows[0];
    if (!row || (userId !== undefined && row.createdBy !== userId)) {
      throw new NotFoundException('清单图片不存在');
    }
    const record: ChecklistRecord = this.toRecord(row);
    if (!record.items.some((item) => item.images.some((image) => image.imageKey === imageKey))) {
      throw new NotFoundException('清单图片不存在');
    }
  }

  async create(draft: ChecklistDraft, userId: string): Promise<CreateChecklistResponse> {
    const inserted: { id: string }[] = await this.db.insert(checklist).values({
      checklistKey: draft.id,
      title: draft.title,
      items: draft.items,
      processedEventIds: [],
      createdBy: userId,
      updatedBy: userId,
    }).onConflictDoNothing({ target: checklist.checklistKey })
      .returning({ id: checklist.id });

    if (inserted.length > 0) return { checklist: draft, created: true };

    const existing: { createdBy: string | null; title: string; items: unknown }[] =
      await this.db.select({
        createdBy: checklist.createdBy,
        title: checklist.title,
        items: checklist.items,
      }).from(checklist).where(eq(checklist.checklistKey, draft.id));

    if (existing.length !== 1 || existing[0].createdBy !== userId ||
        !matchesChecklistDraft(existing[0], draft)) {
      throw new ConflictException('清单标识已被使用或内容不一致');
    }
    return {
      checklist: parseStoredChecklist({
        id: draft.id, title: existing[0].title, items: existing[0].items,
      }),
      created: false,
    };
  }

  async saveConversationName(input: ConversationNameInput, userId: string): Promise<void> {
    if (!userId) throw new UnauthorizedException('请先登录');
    const updated: { id: string }[] = await this.db.update(checklist)
      .set({ conversationName: input.name })
      .where(and(eq(checklist.createdBy, userId), eq(checklist.openChatId, input.chatId)))
      .returning({ id: checklist.id });
    if (!updated.length) throw new NotFoundException('该对话没有属于你的清单');
  }

  async bindMessage(input: ChecklistMessageBinding, userId: string): Promise<void> {
    if (!userId) throw new UnauthorizedException('请先登录');
    for (let attempt: number = 0; attempt < 3; attempt++) {
      const rows: (typeof checklist.$inferSelect)[] = await this.db.select().from(checklist)
        .where(and(eq(checklist.checklistKey, input.checklistId), eq(checklist.createdBy, userId)));
      const row: typeof checklist.$inferSelect | undefined = rows[0];
      if (!row || row.createdBy !== userId) throw new NotFoundException('清单不存在');
      if ((row.openChatId && row.openChatId !== input.openChatId) ||
          (row.openMessageId && row.openMessageId !== input.openMessageId)) {
        throw new ConflictException('清单已关联其他对话或消息');
      }
      if (row.openChatId === input.openChatId && row.openMessageId === input.openMessageId) return;
      const updated: { id: string }[] = await this.db.update(checklist).set({
        openChatId: input.openChatId, openMessageId: input.openMessageId,
        version: row.version + 1, updatedAt: new Date(), updatedBy: userId,
      }).where(and(eq(checklist.id, row.id), eq(checklist.version, row.version),
        eq(checklist.createdBy, userId))).returning({ id: checklist.id });
      if (updated.length) return;
    }
    throw new ConflictException('清单正在更新，请重试');
  }

  async apply(event: ChecklistEvent): Promise<{ duplicate: boolean; checklist: ChecklistDraft }> {
    if (!event.eventId || !event.openMessageId || !event.openChatId) {
      throw new ConflictException('回调缺少事件、消息或会话标识');
    }

    for (let attempt: number = 0; attempt < 5; attempt++) {
      const rows: (typeof checklist.$inferSelect)[] = await this.db.select()
        .from(checklist).where(eq(checklist.checklistKey, event.checklistId));
      const row: typeof checklist.$inferSelect | undefined = rows[0];
      if (!row) throw new NotFoundException('清单不存在');

      if ((row.openMessageId && row.openMessageId !== event.openMessageId) ||
          (row.openChatId && row.openChatId !== event.openChatId)) {
        throw new ConflictException('回调消息或会话与清单不匹配');
      }
      if (!Array.isArray(row.processedEventIds) ||
          !row.processedEventIds.every((id: string) => typeof id === 'string')) {
        throw new ConflictException('清单事件记录无效');
      }

      const current: ChecklistDraft = parseStoredChecklist({
        id: row.checklistKey, title: row.title, items: row.items,
      });
      if (row.processedEventIds.includes(event.eventId)) {
        return { duplicate: true, checklist: current };
      }
      let next: ChecklistDraft;
      try {
        next = updateChecklistItem(current, event.itemId, event.checked);
      } catch {
        throw new NotFoundException('事项不存在');
      }

      const updated: { id: string }[] = await this.db.update(checklist).set({
        items: next.items,
        processedEventIds: [...row.processedEventIds, event.eventId],
        openMessageId: row.openMessageId ?? event.openMessageId,
        openChatId: row.openChatId ?? event.openChatId,
        version: row.version + 1,
        updatedAt: new Date(),
      }).where(and(
        eq(checklist.id, row.id),
        eq(checklist.version, row.version),
      )).returning({ id: checklist.id });
      if (updated.length > 0) return { duplicate: false, checklist: next };
    }

    throw new ConflictException('清单正在更新，请重试');
  }
}
