import { Module } from '@nestjs/common';
import { VendorsService } from './vendors.service';
import { VendorsController } from './vendors.controller';
import { SupabaseService } from '../../database/supabase.client';
import { VendorsRepository } from '../../database/repositories/vendors.repository';
import { AuthModule } from '../auth/auth.module';
import { StellarModule } from '../../stellar/stellar.module';
import { AdminGuard } from '../../common/guards/admin.guard';

@Module({
  imports: [AuthModule, StellarModule],
  providers: [VendorsService, VendorsRepository, SupabaseService, AdminGuard],
  controllers: [VendorsController],
  exports: [VendorsService],
})
export class VendorsModule {}

