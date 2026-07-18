import { Injectable, Logger } from '@nestjs/common';
import { RealtimeService } from '../../realtime/realtime.service';
import { ParsedContractEvent, LoanCreatedPayload, LoanRepaidPayload, LoanDefaultedPayload } from '../interfaces';

@Injectable()
export class RealtimeEventHandler {
  private readonly logger = new Logger(RealtimeEventHandler.name);

  constructor(private readonly realtimeService: RealtimeService) {}

  handleLoanCreated(event: ParsedContractEvent<LoanCreatedPayload>): void {
    this.logger.log(`Handling LOAN_CREATED event for realtime: ${event.payload.loanId}`);
    this.realtimeService.broadcastLoanStatusChanged(event.payload.loanId, 'active', {
      userWallet: event.payload.userWallet,
      principalAmount: String(event.payload.principalAmount),
      interestAmount: String(event.payload.interestAmount),
      dueDate: event.payload.dueDate,
    });
  }

  handleLoanRepaid(event: ParsedContractEvent<LoanRepaidPayload>, newStatus: string): void {
    this.logger.log(`Handling LOAN_REPAID event for realtime: ${event.payload.loanId}`);
    this.realtimeService.broadcastPaymentConfirmed(
      event.payload.loanId,
      event.payload.txHash,
      String(event.payload.amount),
      event.payload.paidAt,
    );
    this.realtimeService.broadcastLoanStatusChanged(event.payload.loanId, newStatus);
  }

  handleLoanDefaulted(event: ParsedContractEvent<LoanDefaultedPayload>): void {
    this.logger.log(`Handling LOAN_DEFAULTED event for realtime: ${event.payload.loanId}`);
    this.realtimeService.broadcastLoanStatusChanged(event.payload.loanId, 'defaulted');
  }
}
