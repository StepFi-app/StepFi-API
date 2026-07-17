import { Module } from '@nestjs/common';
import { VendorsService } from './vendors.service';
import { VendorsController } from './vendors.controller';
import { SupabaseService } from '../../database/supabase.client';
import { VendorsRepository } from '../../database/repositories/vendors.repository';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [VendorsService, VendorsRepository, SupabaseService],
  controllers: [VendorsController],
  exports: [VendorsService],
})
export class VendorsModule {}
