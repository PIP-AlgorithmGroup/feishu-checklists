import {
  ConflictException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, eq } from 'drizzle-orm';
import { checklist } from '../../database/schema';
import type {
  ChecklistDraft,
  CreateChecklistResponse,
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
