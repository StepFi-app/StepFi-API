import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from 'stellar-sdk';
import { SupabaseService } from '../database/supabase.client';
import { SorobanService } from '../blockchain/soroban/soroban.service';
import { EventParserService } from './event-parser.service';
import { JobMonitorService } from '../jobs/monitoring/job-monitor.service';
import {
  ParsedContractEvent,
  LoanEventType,
  ReputationEventType,
  LoanCreatedPayload,
  LoanRepaidPayload,
  LoanDefaultedPayload,
  ScoreChangedPayload,
} from './interfaces';

@Injectable()
export class IndexerService {
  private readonly logger = new Logger(IndexerService.name);
  private isRunning = false;

  private static readonly LEDGER_RETENTION_BUFFER = 100_000;
  private static readonly CATCH_UP_BUFFER = 1_000;

  private readonly loanContractId: string;
  private readonly reputationContractId: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly sorobanService: SorobanService,
    private readonly supabaseService: SupabaseService,
    private readonly eventParser: EventParserService,
    private readonly jobMonitorService: JobMonitorService,
  ) {
    this.loanContractId =
      this.configService.get<string>('CREDIT_LINE_CONTRACT_ID') || '';
    this.reputationContractId =
      this.configService.get<string>('REPUTATION_CONTRACT_ID') || '';
  }

  @Cron('*/60 * * * * *')
  async runIndexer(): Promise<void> {
    if (this.isRunning) {
      this.logger.debug('Indexer already running, skipping');
      return;
    }
    this.isRunning = true;

    this.logger.log('Blockchain indexer cycle started');

    try {
      const loanError = await this.indexLoanContract();
      const reputationError = await this.indexReputationContract();
      const runError = loanError ?? reputationError;

      if (runError) {
        this.jobMonitorService.recordFailure('indexer', runError);
      } else {
        this.jobMonitorService.recordSuccess('indexer');
      }
    } catch (error) {
      this.logger.error({ error: error.message, stack: error.stack }, 'Indexer cycle failed');
      this.jobMonitorService.recordFailure('indexer', error);
    } finally {
      this.isRunning = false;
    }

    this.logger.log('Blockchain indexer cycle completed');
  }

  private async indexLoanContract(): Promise<Error | null> {
    try {
      await this.indexContract(this.loanContractId, 'loan');
      return null;
    } catch (error) {
      this.logger.error(
        { error: error.message, stack: error.stack },
        'Failed to index loan contract events — will retry next cycle',
      );
      return error instanceof Error ? error : new Error(String(error));
    }
  }

  private async indexReputationContract(): Promise<Error | null> {
    try {
      await this.indexContract(this.reputationContractId, 'reputation');
      return null;
    } catch (error) {
      this.logger.error(
        { error: error.message, stack: error.stack },
        'Failed to index reputation contract events — will retry next cycle',
      );
      return error instanceof Error ? error : new Error(String(error));
    }
  }

  private async indexContract(
    contractId: string,
    label: string,
  ): Promise<void> {
    if (!contractId) {
      this.logger.warn(`Skipping ${label} contract indexing — contract ID not configured`);
      return;
    }

    const cursor = await this.getCursor(contractId);
    let startLedger = cursor > 0 ? cursor + 1 : 1;

    this.logger.log(`Starting cycle for ${label}, cursor: ${cursor}, startLedger: ${startLedger}`);

    // Get network tip first so we always have something to persist
    let latestLedger: number;
    try {
      latestLedger = await this.getLatestNetworkLedger();
      this.logger.log(`Latest network ledger for ${label}: ${latestLedger}`);
    } catch (error) {
      this.logger.warn(
        { error: error.message, label },
        `Could not get latest network ledger for ${label} — will retry next cycle`,
      );
      return;
    }

    // Proactive self-heal: fast-forward cursor if it's outside retention window
    startLedger = await this.healStaleCursor(contractId, startLedger, latestLedger, label);

    this.logger.log(`Fetching ${label} events from ledger ${startLedger} to ${latestLedger}`);

    let rawEvents: StellarSdk.SorobanRpc.Api.EventResponse[];
    try {
      rawEvents = await this.fetchEvents(contractId, startLedger, latestLedger);
      this.logger.log(`Fetched ${rawEvents.length} raw ${label} events (startLedger=${startLedger})`);
    } catch (error) {
      this.logger.error(
        { error: error.message, stack: error.stack, label, startLedger },
        `fetchEvents failed for ${label}`,
      );
      if (await this.recoverFromRangeError(contractId, error, label)) {
        return;
      }
      throw error;
    }

    if (rawEvents.length === 0) {
      this.logger.log(`No new ${label} events found — advancing cursor to latest ledger ${latestLedger}`);
      await this.updateCursor(contractId, latestLedger);
      return;
    }

    this.logger.log(`Processing ${rawEvents.length} ${label} events`);

    let maxLedger = startLedger;
    let successCount = 0;
    let errorCount = 0;

    for (const rawEvent of rawEvents) {
      try {
        const parsed = this.eventParser.parseEvent(rawEvent);
        if (!parsed) {
          this.logger.debug(`Skipping unparsed ${label} event: ${rawEvent.id}`);
          continue;
        }

        await this.persistEvent(parsed);
        successCount++;

        if (parsed.ledgerSequence > maxLedger) {
          maxLedger = parsed.ledgerSequence;
        }

        this.logger.log(
          { eventType: parsed.type, eventId: parsed.eventId, txHash: parsed.txHash, ledger: parsed.ledgerSequence },
          `Indexed ${parsed.type} event for ${label}`,
        );
      } catch (error) {
        errorCount++;
        this.logger.error(
          { error: error.message, eventId: rawEvent?.id, label },
          'Failed to persist event — skipping',
        );
      }
    }

    this.logger.log(
      `Persisting cursor for ${label} — maxLedger=${maxLedger}, latestLedger=${latestLedger}, currentCursor=${cursor}`,
    );

    // Always advance cursor past what we've seen: use the network tip if events
    // stopped before it, or the highest processed event ledger if it's behind.
    const targetLedger = Math.max(maxLedger, latestLedger);
    this.logger.log(`Updating ${label} cursor to ${targetLedger} (successCount=${successCount})`);
    await this.updateCursor(contractId, targetLedger);

    this.logger.log(
      `Finished indexing ${label}: ${successCount} ok, ${errorCount} failed, cursor now ${targetLedger}`,
    );
  }

  // -------------------------------------------------------------------------
  // Soroban RPC event fetching
  // -------------------------------------------------------------------------

  private async fetchEvents(
    contractId: string,
    startLedger: number,
    latestLedger: number,
  ): Promise<StellarSdk.SorobanRpc.Api.EventResponse[]> {
    if (startLedger > latestLedger) {
      this.logger.debug(`startLedger (${startLedger}) > latestLedger (${latestLedger}) — nothing to fetch`);
      return [];
    }

    const server = this.sorobanService.getServer();
    this.logger.log(`Calling server.getEvents for contract ${contractId.slice(0, 8)}... startLedger=${startLedger}`);

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

    const events = response.events ?? [];
    this.logger.log(`server.getEvents returned ${events.length} events for startLedger=${startLedger}`);
    return events;
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
        transaction_hash: event.txHash,
        ledger_sequence: event.ledgerSequence,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: 'event_id', ignoreDuplicates: true },
    );

    if (error) {
      if (error.code === '23505') {
        this.logger.debug(`Duplicate LOAN_CREATED event ${event.eventId} — skipping`);
        return;
      }
      throw new Error(`Failed to persist LOAN_CREATED: ${error.message}`);
    }
  }

  private async persistLoanRepaid(
    event: ParsedContractEvent<LoanRepaidPayload>,
  ): Promise<void> {
    const { payload } = event;
    const db = this.supabaseService.getServiceRoleClient();

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

  private async persistScoreChanged(
    event: ParsedContractEvent<ScoreChangedPayload>,
  ): Promise<void> {
    const { payload } = event;
    const db = this.supabaseService.getServiceRoleClient();

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

    const { error: cacheError } = await db
      .from('reputation_cache')
      .update({
        score: payload.newScore,
        last_synced_at: new Date().toISOString(),
      })
      .eq('wallet_address', payload.wallet);

    if (cacheError) {
      this.logger.warn(
        { error: cacheError.message, wallet: payload.wallet },
        'Failed to update reputation cache — history was saved',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Self-healing cursor recovery
  // -------------------------------------------------------------------------

  private async getLatestNetworkLedger(): Promise<number> {
    const { sequence } = await this.sorobanService.getServer().getLatestLedger();
    return sequence;
  }

  private async healStaleCursor(
    contractId: string,
    startLedger: number,
    latestLedger: number,
    label: string,
  ): Promise<number> {
    const minValidLedger = latestLedger - IndexerService.LEDGER_RETENTION_BUFFER;

    this.logger.log(
      `healStaleCursor check for ${label}: startLedger=${startLedger}, latestLedger=${latestLedger}, minValid=${minValidLedger}`,
    );

    if (startLedger >= minValidLedger) {
      this.logger.log(`Cursor for ${label} is healthy — no heal needed`);
      return startLedger;
    }

    const catchUpLedger = latestLedger - IndexerService.CATCH_UP_BUFFER;

    this.logger.warn(
      { label, startLedger, catchUpLedger, latestLedger },
      `Stale cursor detected for ${label}. Jumping from ${startLedger} directly to ${catchUpLedger} (latest: ${latestLedger})`,
    );

    this.logger.log(`Persisting healed cursor for ${label}: ${catchUpLedger - 1}`);
    await this.updateCursor(contractId, catchUpLedger - 1);
    return catchUpLedger;
  }

  private async recoverFromRangeError(
    contractId: string,
    error: unknown,
    label: string,
  ): Promise<boolean> {
    const message = error instanceof Error ? error.message : String(error);

    if (!message.includes('startLedger must be within')) {
      return false;
    }

    const match = message.match(/(\d+)\s*-\s*(\d+)/);
    if (!match) {
      return false;
    }

    const minValidLedger = parseInt(match[1], 10);

    this.logger.warn(
      { label, minValidLedger },
      `Ledger out of range for ${label}. Auto-correcting cursor to ${minValidLedger}.`,
    );

    await this.updateCursor(contractId, minValidLedger - 1);
    return true;
  }

  // -------------------------------------------------------------------------
  // Cursor management
  // -------------------------------------------------------------------------

  async getCursor(contractId: string): Promise<number> {
    const db = this.supabaseService.getServiceRoleClient();

    const { data, error } = await db
      .from('indexer_state')
      .select('last_ledger')
      .eq('contract_id', contractId)
      .single();

    if (error || !data) {
      this.logger.log(`No existing cursor for contract ${contractId.slice(0, 8)}... — starting from 0`);
      return 0;
    }

    return Number(data.last_ledger);
  }

  async updateCursor(contractId: string, ledger: number): Promise<void> {
    const db = this.supabaseService.getServiceRoleClient();
    const ts = new Date().toISOString();

    this.logger.log(
      `Upserting cursor for ${contractId.slice(0, 8)}... to ledger ${ledger} at ${ts}`,
    );

    const { error } = await db.from('indexer_state').upsert(
      {
        contract_id: contractId,
        last_ledger: ledger,
        updated_at: ts,
      },
      { onConflict: 'contract_id' },
    );

    if (error) {
      this.logger.error(
        { error: error.message, contractId: contractId.slice(0, 8) + '...', ledger },
        'Failed to update indexer cursor',
      );
      throw new Error(`Failed to update indexer cursor: ${error.message}`);
    }

    this.logger.log(`Cursor updated successfully for ${contractId.slice(0, 8)}... to ledger ${ledger}`);
  }
}
