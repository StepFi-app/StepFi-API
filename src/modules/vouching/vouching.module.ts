import { Module } from '@nestjs/common';
import { VouchingService } from './vouching.service';
import { VouchingController } from './vouching.controller';
import { SupabaseService } from '../../database/supabase.client';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [VouchingService, SupabaseService],
  controllers: [VouchingController],
  exports: [VouchingService],
})
export class VouchingModule {}
