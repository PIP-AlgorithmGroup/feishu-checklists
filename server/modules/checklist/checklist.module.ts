import { Module } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { raw } from 'express';
import { ChecklistController } from './checklist.controller';
import { ChecklistCallbackController } from './checklist-callback.controller';
import { ChecklistService } from './checklist.service';

@Module({
  controllers: [ChecklistController, ChecklistCallbackController],
  providers: [ChecklistService],
})
export class ChecklistModule {
  constructor(adapterHost: HttpAdapterHost) {
    const prefix: string = (process.env.CLIENT_BASE_PATH ?? '').replace(/\/$/, '');
    // The platform JSON parser runs after module construction; preserve exact bytes for Feishu's signature.
    adapterHost.httpAdapter.getInstance().use(
      `${prefix}/feishu-card-callback`, raw({ type: 'application/json', limit: '1mb' }),
    );
  }
}
