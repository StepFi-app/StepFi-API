import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoanPaymentReminderService } from './loan-payment-reminder.service';
import { SupabaseService } from '../../database/supabase.client';

@Module({
  imports: [ConfigModule],
  providers: [LoanPaymentReminderService, SupabaseService],
})
export class LoanPaymentReminderModule {}
