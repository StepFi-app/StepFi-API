import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { SupabaseService } from '../../database/supabase.client';

@Module({
  controllers: [AuditController],
  providers: [AuditService, SupabaseService],
  exports: [AuditService],
})
export class AdminModule {}
