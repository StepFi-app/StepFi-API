import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AdminRolesController } from './admin-roles.controller';
import { SupabaseService } from '../../database/supabase.client';
import { UsersRepository } from '../../database/repositories/users.repository';
import { UserStatusService } from '../auth/user-status.service';
import { AdminGuard } from './admin.guard';

@Module({
  controllers: [AuditController, AdminRolesController],
  providers: [AuditService, SupabaseService, UsersRepository, UserStatusService, AdminGuard],
  exports: [AuditService, UserStatusService, AdminGuard],
})
export class AdminModule {}
