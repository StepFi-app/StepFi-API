import { Injectable, Logger } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  constructor(private readonly realtimeGateway: RealtimeGateway) {}

  broadcastLoanStatusChanged(loanId: string, status: string, details?: Record<string, unknown>): void {
    this.logger.log(`Broadcasting loan.status_changed for loan ${loanId} (status=${status})`);
    this.realtimeGateway.broadcast('loan.status_changed', {
      loanId,
      status,
      ...details,
    });
  }

  broadcastPaymentConfirmed(
    loanId: string,
    txHash: string,
    amount: string | number,
    paidAt: string,
  ): void {
    this.logger.log(`Broadcasting payment.confirmed for loan ${loanId} (amount=${amount})`);
    this.realtimeGateway.broadcast('payment.confirmed', {
      loanId,
      txHash,
      amount,
      paidAt,
    });
  }
}
