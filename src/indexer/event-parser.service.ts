import { Injectable, Logger } from '@nestjs/common';
import * as StellarSdk from 'stellar-sdk';
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
 * Parses raw Soroban contract events into typed DTOs.
 *
 * Soroban events follow the structure:
 *   topic[0] = Symbol (event name, e.g. "LOAN_CREATED")
 *   topic[1..n] = key fields (wallet address, loan id, etc.)
 *   value = xdr.ScVal with event data
 *
 * The Stellar SDK `EventResponse` has:
 *   topic: xdr.ScVal[]   (already decoded from XDR)
 *   value: xdr.ScVal
 *   id: string            (unique event identifier)
 *   ledger: number
 *   pagingToken: string
 *
 * NOTE: There is no `txHash` property on `EventResponse`. We derive a
 * pseudo-hash from the event `id` (format: "ledger-txIndex-eventIndex").
 */
@Injectable()
export class EventParserService {
  private readonly logger = new Logger(EventParserService.name);

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Attempts to parse a raw Soroban event into a typed ParsedContractEvent.
   * Returns null if the event type is unrecognised.
   */
  parseEvent(
    rawEvent: StellarSdk.SorobanRpc.Api.EventResponse,
  ): ParsedContractEvent | null {
    try {
      const eventName = this.scValToString(rawEvent.topic[0]);
      const eventId = rawEvent.id;
      // EventResponse doesn't expose txHash directly — use the event id
      // which encodes (ledger-txIndex-opIndex) and is unique per event.
      const txHash = eventId;
      const ledgerSequence = rawEvent.ledger;

      switch (eventName) {
        case LoanEventType.LOAN_CREATED:
          return {
            eventId,
            txHash,
            ledgerSequence,
            type: LoanEventType.LOAN_CREATED,
            payload: this.parseLoanCreated(rawEvent),
          };

        case LoanEventType.LOAN_REPAID:
          return {
            eventId,
            txHash,
            ledgerSequence,
            type: LoanEventType.LOAN_REPAID,
            payload: this.parseLoanRepaid(rawEvent),
          };

        case LoanEventType.LOAN_DEFAULTED:
          return {
            eventId,
            txHash,
            ledgerSequence,
            type: LoanEventType.LOAN_DEFAULTED,
            payload: this.parseLoanDefaulted(rawEvent),
          };

        case ReputationEventType.SCORE_CHANGED:
        case ReputationEventType.SCORE_UPDATED:
          return {
            eventId,
            txHash,
            ledgerSequence,
            type: eventName as ReputationEventType,
            payload: this.parseScoreChanged(rawEvent),
          };

        default:
          this.logger.debug(
            `Ignoring unrecognised event type: ${eventName}`,
          );
          return null;
      }
    } catch (error) {
      this.logger.warn(
        {
          context: 'EventParserService',
          action: 'parseEvent',
          error: error.message,
          eventId: rawEvent?.id,
        },
        'Failed to parse event — skipping',
      );
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Individual parsers
  // -------------------------------------------------------------------------

  /**
   * LOAN_CREATED event layout:
   *   topic[0] = Symbol("LOAN_CREATED")
   *   topic[1] = Address (user_wallet)
   *   value    = Map { loan_id: String, principal: i128, interest: i128, due_date?: u64 }
   */
  private parseLoanCreated(
    raw: StellarSdk.SorobanRpc.Api.EventResponse,
  ): LoanCreatedPayload {
    const userWallet = this.scValToString(raw.topic[1]);
    const valueMap = this.scValToNativeMap(raw.value);

    return {
      loanId: String(valueMap.loan_id ?? ''),
      userWallet,
      principalAmount: this.stroopsToDecimal(valueMap.principal ?? 0),
      interestAmount: this.stroopsToDecimal(valueMap.interest ?? 0),
      dueDate: valueMap.due_date
        ? new Date(Number(valueMap.due_date) * 1000).toISOString()
        : null,
    };
  }

  /**
   * LOAN_REPAID event layout:
   *   topic[0] = Symbol("LOAN_REPAID")
   *   topic[1] = String (loan_id)
   *   value    = Map { amount: i128, paid_at: u64 }
   */
  private parseLoanRepaid(
    raw: StellarSdk.SorobanRpc.Api.EventResponse,
  ): LoanRepaidPayload {
    const loanId = this.scValToString(raw.topic[1]);
    const valueMap = this.scValToNativeMap(raw.value);

    return {
      loanId,
      txHash: raw.id,
      amount: this.stroopsToDecimal(valueMap.amount ?? 0),
      paidAt: valueMap.paid_at
        ? new Date(Number(valueMap.paid_at) * 1000).toISOString()
        : new Date().toISOString(),
    };
  }

  /**
   * LOAN_DEFAULTED event layout:
   *   topic[0] = Symbol("LOAN_DEFAULTED")
   *   topic[1] = String (loan_id)
   */
  private parseLoanDefaulted(
    raw: StellarSdk.SorobanRpc.Api.EventResponse,
  ): LoanDefaultedPayload {
    return {
      loanId: this.scValToString(raw.topic[1]),
    };
  }

  /**
   * SCORE_CHANGED / SCORE_UPDATED event layout:
   *   topic[0] = Symbol("SCORE_CHANGED" | "SCORE_UPDATED")
   *   topic[1] = Address (wallet)
   *   value    = Map { old_score: u32, new_score: u32, reason: String }
   */
  private parseScoreChanged(
    raw: StellarSdk.SorobanRpc.Api.EventResponse,
  ): ScoreChangedPayload {
    const wallet = this.scValToString(raw.topic[1]);
    const valueMap = this.scValToNativeMap(raw.value);

    return {
      wallet,
      oldScore: Number(valueMap.old_score ?? 0),
      newScore: Number(valueMap.new_score ?? 0),
      reason: String(valueMap.reason ?? 'unknown'),
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Converts an xdr.ScVal to its native JS representation as a string.
   * Topics in `EventResponse` are already decoded `xdr.ScVal` objects.
   */
  private scValToString(scVal: StellarSdk.xdr.ScVal): string {
    try {
      const native = StellarSdk.scValToNative(scVal);
      return String(native);
    } catch {
      return '';
    }
  }

  /** Converts an xdr.ScVal (expected to be a Map) to a plain JS object. */
  private scValToNativeMap(value: StellarSdk.xdr.ScVal): Record<string, unknown> {
    try {
      const native = StellarSdk.scValToNative(value);
      if (native && typeof native === 'object') {
        return native as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }

  /** Converts stroops (i128, 7 decimal places) to a human-readable number. */
  private stroopsToDecimal(stroops: unknown): number {
    return Number(BigInt(stroops as string | number | bigint)) / 10_000_000;
  }
}
