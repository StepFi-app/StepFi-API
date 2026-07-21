import { Injectable, Logger } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { SupabaseService } from '../database/supabase.client';

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  constructor(
    private readonly realtimeGateway: RealtimeGateway,
    private readonly supabaseService: SupabaseService,
  ) {}

  private async getUserWalletForLoan(loanId: string): Promise<string | null> {
    try {
      const client = this.supabaseService.getServiceRoleClient();
      const { data, error } = await client
        .from('loans')
        .select('user_wallet')
        .eq('id', loanId)
        .single();

      if (error || !data) {
        this.logger.error(`Failed to find user_wallet for loan ${loanId}: ${error?.message}`);
        return null;
      }
      return data.user_wallet as string;
    } catch (err) {
      this.logger.error(`Error querying user_wallet for loan ${loanId}: ${err.message}`);
      return null;
    }
  }

  async broadcastLoanStatusChanged(
    loanId: string,
    status: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    this.logger.log(`Handling realtime notification for loan.status_changed for loan ${loanId} (status=${status})`);

    let wallet = details?.userWallet as string | undefined;
    if (!wallet) {
      wallet = (await this.getUserWalletForLoan(loanId)) || undefined;
    }

    if (!wallet) {
      this.logger.warn(`Skipping event broadcast for loan ${loanId} as no wallet could be resolved.`);
      return;
    }

    this.realtimeGateway.sendToUser(wallet, 'loan.status_changed', {
      loanId,
      status,
      ...details,
    });
  }

  async broadcastPaymentConfirmed(
    loanId: string,
    txHash: string,
    amount: string | number,
    paidAt: string,
  ): Promise<void> {
    this.logger.log(`Handling realtime notification for payment.confirmed for loan ${loanId} (amount=${amount})`);

    const wallet = await this.getUserWalletForLoan(loanId);
    if (!wallet) {
      this.logger.warn(`Skipping event broadcast for loan ${loanId} as no wallet could be resolved.`);
      return;
    }

    this.realtimeGateway.sendToUser(wallet, 'payment.confirmed', {
      loanId,
      txHash,
      amount,
      paidAt,
    });
  }
}
