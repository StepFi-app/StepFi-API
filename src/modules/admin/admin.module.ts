import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { SupabaseService } from '../../database/supabase.client';
import { AdminGuard } from '../../auth/guards/admin.guard';

@Module({
  controllers: [AuditController],
  providers: [AuditService, SupabaseService, AdminGuard],
  exports: [AuditService],
})
export class AdminModule {}
