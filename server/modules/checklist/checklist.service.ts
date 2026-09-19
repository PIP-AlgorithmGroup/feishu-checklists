import { ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq } from 'drizzle-orm';
import { checklist } from '../../database/schema';
import type {
  ChecklistDraft,
  CreateChecklistResponse,
} from '../../../shared/api.interface';
import { matchesChecklistDraft } from './checklist';

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
    return { checklist: draft, created: false };
  }
}
