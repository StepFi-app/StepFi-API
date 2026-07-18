import { Module } from '@nestjs/common';
import { StellarModule } from '../../stellar/stellar.module';
import { HealthController } from './health.controller';
import { StellarTomlController } from './stellar-toml.controller';
import { HealthService } from './health.service';
import { SupabaseService } from '../../database/supabase.client';

@Module({
  imports: [
    StellarModule,
  ],
  controllers: [HealthController, StellarTomlController],
  providers: [HealthService, SupabaseService],
})
export class HealthModule {}
