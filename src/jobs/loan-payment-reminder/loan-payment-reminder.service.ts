import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseService } from '../../database/supabase.client';
import {
  ActiveLoan,
  VendorInfo,
  ReminderCandidate,
  ReminderSummary,
  ReminderType,
} from './interfaces/reminder.interfaces';
import { JobMonitorService } from '../monitoring/job-monitor.service';

const REMINDER_TITLES: Record<ReminderType, string> = {
  payment_reminder_3d: 'Payment Due in 3 Days',
  payment_reminder_1d: 'Payment Due Tomorrow',
  payment_overdue: 'Loan Payment Overdue',
};

function buildMessage(type: ReminderType, amount: string, dueDate: string): string {
  const formatted = new Date(dueDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
  switch (type) {
    case 'payment_reminder_3d':
      return `Your loan payment of ${amount} XLM is due on ${formatted} (in 3 days). Please ensure your wallet has sufficient funds.`;
    case 'payment_reminder_1d':
      return `Your loan payment of ${amount} XLM is due tomorrow, ${formatted}. Please ensure your wallet has sufficient funds.`;
    case 'payment_overdue':
      return `Your loan payment of ${amount} XLM was due on ${formatted} and is now overdue. Please make your payment as soon as possible to avoid penalties.`;
  }
}

@Injectable()
export class LoanPaymentReminderService {
  private readonly logger = new Logger(LoanPaymentReminderService.name);
  private isRunning = false;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly jobMonitorService: JobMonitorService,
  ) {}

  @Cron('0 9 * * *')
  async sendPaymentReminders(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    let runFailure: unknown;

    const summary: ReminderSummary = {
      total: 0,
      created: 0,
      skipped: 0,
      failed: 0,
      breakdown: { payment_reminder_3d: 0, payment_reminder_1d: 0, payment_overdue: 0 },
    };

    try {
      this.logger.log('Loan payment reminder job started');
      const loans = await this.fetchActiveLoans();

      if (loans.length === 0) {
        this.logger.log('No active loans found — skipping reminder run');
        return;
      }

      this.logger.log(`Processing ${loans.length} active loans`);
      const candidates = this.identifyCandidates(loans);
      summary.total = candidates.length;

      this.logger.log(`Identified ${candidates.length} reminder candidates from ${loans.length} active loans`);
      const vendorCache = new Map<string, VendorInfo>();

      for (const candidate of candidates) {
        try {
          const vendor = await this.getVendor(candidate.loan.vendor_id, vendorCache);
          const isDuplicate = await this.isDuplicateReminder(
            candidate.loan.id,
            candidate.reminderType,
          );

          if (isDuplicate) {
            summary.skipped++;
            this.logger.log(`Skipping duplicate reminder for loan ${candidate.loan.loan_id} (${candidate.reminderType})`);
            continue;
          }

          await this.createNotification(candidate, vendor);
          summary.created++;
          summary.breakdown[candidate.reminderType]++;
        } catch (error) {
          runFailure ??= error;
          summary.failed++;
          this.logger.error(`Failed to process reminder candidate for loan ${candidate.loan.loan_id}: ${error.message}`);
        }
      }
    } catch (error) {
      runFailure = error;
      this.logger.error(`Fatal error during reminder job: ${error.message}`);
    } finally {
      if (runFailure) {
        this.jobMonitorService.recordFailure(
          'loanPaymentReminder',
          runFailure,
        );
      } else {
        this.jobMonitorService.recordSuccess('loanPaymentReminder');
      }
      this.logger.log(`Reminder job complete — created: ${summary.created}, skipped: ${summary.skipped}, failed: ${summary.failed}`);
      this.isRunning = false;
    }
  }

  private async fetchActiveLoans(): Promise<ActiveLoan[]> {
    const db = this.supabaseService.getServiceRoleClient();
    const { data, error } = await db
      .from('loans')
      .select('id, loan_id, user_wallet, vendor_id, amount, loan_amount, next_payment_due, remaining_balance, term')
      .eq('status', 'active')
      .not('next_payment_due', 'is', null);

    if (error) {
      throw new Error(`Failed to fetch active loans: ${error.message}`);
    }

    return (data ?? []) as ActiveLoan[];
  }

  private identifyCandidates(loans: ActiveLoan[]): ReminderCandidate[] {
    const nowUtc = new Date();
    const todayUtc = Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate());
    const candidates: ReminderCandidate[] = [];

    for (const loan of loans) {
      if (!loan.next_payment_due) continue;

      const dueUtc = new Date(loan.next_payment_due);
      const dueDayUtc = Date.UTC(dueUtc.getUTCFullYear(), dueUtc.getUTCMonth(), dueUtc.getUTCDate());
      const daysUntilDue = Math.round((dueDayUtc - todayUtc) / 86_400_000);

      let reminderType: ReminderType | null = null;

      if (daysUntilDue === 3) {
        reminderType = 'payment_reminder_3d';
      } else if (daysUntilDue === 1) {
        reminderType = 'payment_reminder_1d';
      } else if (daysUntilDue < 0) {
        reminderType = 'payment_overdue';
      }

      if (reminderType) {
        candidates.push({ loan, reminderType, daysUntilDue });
      }
    }

    return candidates;
  }

  private async isDuplicateReminder(loanDbId: string, type: ReminderType): Promise<boolean> {
    const db = this.supabaseService.getServiceRoleClient();
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const { count, error } = await db
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('type', type)
      .eq('data->>loan_db_id', loanDbId)
      .gte('created_at', todayStart.toISOString());

    if (error) {
      this.logger.warn(`Could not check for duplicate reminder: ${error.message}`);
      return false;
    }

    return (count ?? 0) > 0;
  }

  private async getVendor(
    vendorId: string | null,
    cache: Map<string, VendorInfo>,
  ): Promise<VendorInfo | null> {
    if (!vendorId) return null;
    if (cache.has(vendorId)) return cache.get(vendorId)!;

    const db = this.supabaseService.getServiceRoleClient();
    const { data, error } = await db
      .from('vendors')
      .select('id, name')
      .eq('id', vendorId)
      .single();

    if (error || !data) return null;

    const vendor: VendorInfo = { id: data.id, name: data.name };
    cache.set(vendorId, vendor);
    return vendor;
  }

  private async createNotification(
    candidate: ReminderCandidate,
    vendor: VendorInfo | null,
  ): Promise<void> {
    const { loan, reminderType } = candidate;
    const db = this.supabaseService.getServiceRoleClient();

    const title = REMINDER_TITLES[reminderType];
    const message = buildMessage(reminderType, loan.loan_amount, loan.next_payment_due!);

    const notificationData: Record<string, unknown> = {
      loan_db_id: loan.id,
      loan_id: loan.loan_id,
      loan_amount: loan.loan_amount,
      remaining_balance: loan.remaining_balance,
      due_date: loan.next_payment_due,
    };

    if (vendor) {
      notificationData.vendor_id = vendor.id;
      notificationData.vendor_name = vendor.name;
    }

    const { error } = await db.from('notifications').insert({
      user_wallet: loan.user_wallet,
      type: reminderType,
      title,
      message,
      data: notificationData,
      is_read: false,
      created_at: new Date().toISOString(),
    });

    if (error) {
      throw new Error(`Failed to insert notification: ${error.message}`);
    }

    this.logger.log(`Reminder notification created: ${reminderType} for loan ${loan.loan_id}`);
  }
}
