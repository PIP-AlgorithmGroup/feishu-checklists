import { Module } from '@nestjs/common';
import { ChecklistController } from './checklist.controller';
import { CallbackProbeController } from './callback-probe.controller';
import { ChecklistService } from './checklist.service';

@Module({
  controllers: [ChecklistController, CallbackProbeController],
  providers: [ChecklistService],
})
export class ChecklistModule {}
