/**
 * Parsed event types emitted by the on-chain loan (CreditLine) contract.
 */
export enum LoanEventType {
  LOAN_CREATED = 'LOAN_CREATED',
  LOAN_REPAID = 'LOAN_REPAID',
  LOAN_DEFAULTED = 'LOAN_DEFAULTED',
}

/**
 * Parsed event types emitted by the on-chain Reputation contract.
 */
export enum ReputationEventType {
  SCORE_CHANGED = 'SCORE_CHANGED',
  SCORE_UPDATED = 'SCORE_UPDATED',
}

// ---------------------------------------------------------------------------
// Parsed event payloads
// ---------------------------------------------------------------------------

export interface LoanCreatedPayload {
  loanId: string;
  userWallet: string;
  principalAmount: number;
  interestAmount: number;
  dueDate: string | null;
}

export interface LoanRepaidPayload {
  loanId: string;
  txHash: string;
  amount: number;
  paidAt: string;
}

export interface LoanDefaultedPayload {
  loanId: string;
}

export interface ScoreChangedPayload {
  wallet: string;
  oldScore: number;
  newScore: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// Generic wrapper returned by the event parser
// ---------------------------------------------------------------------------

export interface ParsedContractEvent<T = unknown> {
  /** Unique Soroban event identifier (ledger-txIndex-eventIndex) */
  eventId: string;
  /** Stellar transaction hash that contains this event */
  txHash: string;
  /** Ledger sequence number */
  ledgerSequence: number;
  /** Event type */
  type: LoanEventType | ReputationEventType;
  /** Typed payload */
  payload: T;
}

// ---------------------------------------------------------------------------
// Indexer cursor
// ---------------------------------------------------------------------------

export interface IndexerCursor {
  contractId: string;
  lastLedger: number;
  updatedAt: string;
}
