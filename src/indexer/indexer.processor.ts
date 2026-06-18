import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import * as StellarSdk from 'stellar-sdk';
import { SupabaseService } from '../database/supabase.client';
import { SorobanService } from '../blockchain/soroban/soroban.service';
import { EventParserService } from './event-parser.service';
import {
  ParsedContractEvent,
  LoanEventType,
  ReputationEventType,
  LoanCreatedPayload,
  LoanRepaidPayload,
  LoanDefaultedPayload,
  ScoreChangedPayload,
} from './interfaces';

/**
 * BullMQ processor for the `blockchain-indexer` queue.
 *
 * On every invocation (every 6 s) it:
 *  1. Reads the last indexed ledger per contract from `indexer_state`.
 *  2. Fetches new Soroban events since that ledger.
 *  3. Parses, deduplicates, and persists them to the database.
 *  4. Updates the cursor so the next run resumes correctly.
 */
@Processor('blockchain-indexer')
export class IndexerProcessor extends WorkerHost {
  private readonly logger = new Logger(IndexerProcessor.name);

  private readonly loanContractId: string;
  private readonly reputationContractId: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly sorobanService: SorobanService,
    private readonly supabaseService: SupabaseService,
    private readonly eventParser: EventParserService,
  ) {
    super();
    this.loanContractId =
      this.configService.get<string>('CREDIT_LINE_CONTRACT_ID') || '';
    this.reputationContractId =
      this.configService.get<string>('REPUTATION_CONTRACT_ID') || '';
  }

  // -------------------------------------------------------------------------
  // Worker entry point
  // -------------------------------------------------------------------------

  async process(_job: Job): Promise<void> {
    this.logger.log({
      context: 'IndexerProcessor',
      action: 'process',
    }, 'Blockchain indexer job started');

    try {
      await this.indexContract(this.loanContractId, 'loan');
    } catch (error) {
      this.logger.error({
        context: 'IndexerProcessor',
        action: 'indexLoanContract',
        error: error.message,
        stack: error.stack,
      }, 'Failed to index loan contract events — will retry next cycle');
    }

    try {
      await this.indexContract(this.reputationContractId, 'reputation');
    } catch (error) {
      this.logger.error({
        context: 'IndexerProcessor',
        action: 'indexReputationContract',
        error: error.message,
        stack: error.stack,
      }, 'Failed to index reputation contract events — will retry next cycle');
    }

    this.logger.log({
      context: 'IndexerProcessor',
      action: 'process',
    }, 'Blockchain indexer job completed');
  }

  // -------------------------------------------------------------------------
  // Contract indexing
  // -------------------------------------------------------------------------

  private async indexContract(
    contractId: string,
    label: string,
  ): Promise<void> {
    if (!contractId) {
      this.logger.warn(
        `Skipping ${label} contract indexing — contract ID not configured`,
      );
      return;
    }

    const cursor = await this.getCursor(contractId);
    const startLedger = cursor + 1;

    this.logger.debug({
        context: 'IndexerProcessor',
      contractId: contractId.slice(0, 8) + '...',
      label,
      startLedger,
    }, `Polling for ${label} events from ledger ${startLedger}`);

    const rawEvents = await this.fetchEvents(contractId, startLedger);

    if (rawEvents.length === 0) {
      this.logger.debug(`No new ${label} events found`);
      return;
    }

    this.logger.log({
      context: 'IndexerProcessor',
      action: 'indexContract',
      label,
      eventCount: rawEvents.length,
    }, `Found ${rawEvents.length} new ${label} event(s)`);

    let maxLedger = cursor;
    let successCount = 0;
    let errorCount = 0;

    for (const rawEvent of rawEvents) {
      try {
        const parsed = this.eventParser.parseEvent(rawEvent);
        if (!parsed) continue;

        await this.persistEvent(parsed);
        successCount++;

        if (parsed.ledgerSequence > maxLedger) {
          maxLedger = parsed.ledgerSequence;
        }

        this.logger.log({
          context: 'IndexerProcessor',
          action: 'eventIndexed',
          eventType: parsed.type,
          eventId: parsed.eventId,
          txHash: parsed.txHash,
          ledger: parsed.ledgerSequence,
          timestamp: new Date().toISOString(),
        }, `Indexed ${parsed.type} event`);
      } catch (error) {
        errorCount++;
        this.logger.error({
          context: 'IndexerProcessor',
          action: 'persistEvent',
          error: error.message,
          eventId: rawEvent?.id,
        }, 'Failed to persist event — skipping');
      }
    }

    // Update cursor to the highest ledger we successfully processed
    if (maxLedger > cursor) {
      await this.updateCursor(contractId, maxLedger);
    }

    this.logger.log({
      context: 'IndexerProcessor',
      action: 'indexContractComplete',
      label,
      successCount,
      errorCount,
    }, `Finished indexing ${label}: ${successCount} ok, ${errorCount} failed`);
  }

  // -------------------------------------------------------------------------
  // Soroban RPC event fetching
  // -------------------------------------------------------------------------

  private async fetchEvents(
    contractId: string,
    startLedger: number,
  ): Promise<StellarSdk.SorobanRpc.Api.EventResponse[]> {
    const server = this.sorobanService.getServer();

    const response = await server.getEvents({
      startLedger,
      filters: [
        {
          type: 'contract' as StellarSdk.SorobanRpc.Api.EventType,
          contractIds: [contractId],
        },
      ],
      limit: 100,
    });

    return response.events ?? [];
  }

  // -------------------------------------------------------------------------
  // Event persistence (with idempotency)
  // -------------------------------------------------------------------------

  private async persistEvent(event: ParsedContractEvent): Promise<void> {
    switch (event.type) {
      case LoanEventType.LOAN_CREATED:
        await this.persistLoanCreated(event as ParsedContractEvent<LoanCreatedPayload>);
        break;
      case LoanEventType.LOAN_REPAID:
        await this.persistLoanRepaid(event as ParsedContractEvent<LoanRepaidPayload>);
        break;
      case LoanEventType.LOAN_DEFAULTED:
        await this.persistLoanDefaulted(event as ParsedContractEvent<LoanDefaultedPayload>);
        break;
      case ReputationEventType.SCORE_CHANGED:
      case ReputationEventType.SCORE_UPDATED:
        await this.persistScoreChanged(event as ParsedContractEvent<ScoreChangedPayload>);
        break;
    }
  }

  /**
   * Inserts a new loan record into `loan_index`.
   * Idempotent: `event_id` has a unique constraint — conflicts are ignored.
   */
  private async persistLoanCreated(
    event: ParsedContractEvent<LoanCreatedPayload>,
  ): Promise<void> {
    const { payload } = event;
    const db = this.supabaseService.getServiceRoleClient();

    const { error } = await db.from('loan_index').upsert(
      {
        loan_id: payload.loanId,
        user_wallet: payload.userWallet,
        status: 'active',
        principal_amount: payload.principalAmount,
        interest_amount: payload.interestAmount,
        due_date: payload.dueDate,
        event_id: event.eventId,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: 'event_id', ignoreDuplicates: true },
    );

    if (error) {
      // 23505 = unique_violation — means this event was already indexed (idempotent)
      if (error.code === '23505') {
        this.logger.debug(`Duplicate LOAN_CREATED event ${event.eventId} — skipping`);
        return;
      }
      throw new Error(`Failed to persist LOAN_CREATED: ${error.message}`);
    }
  }

  /**
   * Inserts a payment record and updates the loan's remaining balance.
   * Idempotent: `(tx_hash, loan_id)` has a unique constraint.
   */
  private async persistLoanRepaid(
    event: ParsedContractEvent<LoanRepaidPayload>,
  ): Promise<void> {
    const { payload } = event;
    const db = this.supabaseService.getServiceRoleClient();

    // 1. Insert payment record
    const { error: paymentError } = await db.from('payment_index').insert({
      loan_id: payload.loanId,
      tx_hash: payload.txHash,
      amount: payload.amount,
      paid_at: payload.paidAt,
    });

    if (paymentError) {
      if (paymentError.code === '23505') {
        this.logger.debug(
          `Duplicate LOAN_REPAID event (tx=${payload.txHash}, loan=${payload.loanId}) — skipping`,
        );
        return;
      }
      throw new Error(`Failed to persist LOAN_REPAID payment: ${paymentError.message}`);
    }

    // 2. Update loan_index: reduce the remaining balance proxy
    //    We recalculate from all payments for atomicity
    const { data: payments, error: sumError } = await db
      .from('payment_index')
      .select('amount')
      .eq('loan_id', payload.loanId);

    if (sumError) {
      this.logger.warn(
        `Could not recalculate balance for loan ${payload.loanId}: ${sumError.message}`,
      );
      return;
    }

    const totalPaid = (payments ?? []).reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );

    // Fetch loan to determine if fully repaid
    const { data: loan } = await db
      .from('loan_index')
      .select('principal_amount, interest_amount')
      .eq('loan_id', payload.loanId)
      .single();

    if (loan) {
      const totalOwed = Number(loan.principal_amount) + Number(loan.interest_amount);
      const newStatus = totalPaid >= totalOwed ? 'paid' : 'active';

      await db
        .from('loan_index')
        .update({
          status: newStatus,
          last_synced_at: new Date().toISOString(),
        })
        .eq('loan_id', payload.loanId);
    }
  }

  /**
   * Updates loan status to `defaulted`.
   * Idempotent: setting status to 'defaulted' is a no-op if already set.
   */
  private async persistLoanDefaulted(
    event: ParsedContractEvent<LoanDefaultedPayload>,
  ): Promise<void> {
    const db = this.supabaseService.getServiceRoleClient();

    const { error } = await db
      .from('loan_index')
      .update({
        status: 'defaulted',
        last_synced_at: new Date().toISOString(),
      })
      .eq('loan_id', event.payload.loanId);

    if (error) {
      throw new Error(`Failed to persist LOAN_DEFAULTED: ${error.message}`);
    }
  }

  /**
   * Inserts a reputation change into `reputation_history` and updates `reputation_cache`.
   * Idempotent: `event_id` has a unique constraint on `reputation_history`.
   */
  private async persistScoreChanged(
    event: ParsedContractEvent<ScoreChangedPayload>,
  ): Promise<void> {
    const { payload } = event;
    const db = this.supabaseService.getServiceRoleClient();

    // 1. Insert history record
    const { error: historyError } = await db.from('reputation_history').insert({
      event_id: event.eventId,
      user_wallet: payload.wallet,
      old_score: payload.oldScore,
      new_score: payload.newScore,
      change_amount: payload.newScore - payload.oldScore,
      reason: payload.reason,
      transaction_hash: event.txHash,
      ledger_sequence: event.ledgerSequence,
    });

    if (historyError) {
      if (historyError.code === '23505') {
        this.logger.debug(`Duplicate reputation event ${event.eventId} — skipping`);
        return;
      }
      throw new Error(`Failed to persist SCORE_CHANGED history: ${historyError.message}`);
    }

    // 2. Update reputation_cache with latest score
    const { error: cacheError } = await db
      .from('reputation_cache')
      .update({
        score: payload.newScore,
        last_synced_at: new Date().toISOString(),
      })
      .eq('wallet_address', payload.wallet);

    if (cacheError) {
      // Non-fatal: cache update failure should not block event processing
      this.logger.warn({
        context: 'IndexerProcessor',
        action: 'updateReputationCache',
        error: cacheError.message,
        wallet: payload.wallet,
      }, 'Failed to update reputation cache — history was saved');
    }
  }

  // -------------------------------------------------------------------------
  // Cursor management
  // -------------------------------------------------------------------------

  /**
   * Reads the last indexed ledger for a contract from `indexer_state`.
   * Returns 0 if no cursor exists (first run).
   */
  async getCursor(contractId: string): Promise<number> {
    const db = this.supabaseService.getServiceRoleClient();

    const { data, error } = await db
      .from('indexer_state')
      .select('last_ledger')
      .eq('contract_id', contractId)
      .single();

    if (error || !data) {
      return 0;
    }

    return Number(data.last_ledger);
  }

  /**
   * Upserts the cursor for a contract to the given ledger sequence.
   */
  async updateCursor(contractId: string, ledger: number): Promise<void> {
    const db = this.supabaseService.getServiceRoleClient();

    const { error } = await db.from('indexer_state').upsert(
      {
        contract_id: contractId,
        last_ledger: ledger,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'contract_id' },
    );

    if (error) {
      this.logger.error({
        context: 'IndexerProcessor',
        action: 'updateCursor',
        error: error.message,
        contractId,
        ledger,
      }, 'Failed to update indexer cursor');
    }
  }
}
