import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { IndexerProcessor } from '../../../../src/indexer/indexer.processor';
import { EventParserService } from '../../../../src/indexer/event-parser.service';
import { SupabaseService } from '../../../../src/database/supabase.client';
import { SorobanService } from '../../../../src/blockchain/soroban/soroban.service';
import {
  LoanEventType,
  ReputationEventType,
  LoanCreatedPayload,
  LoanRepaidPayload,
  LoanDefaultedPayload,
  ScoreChangedPayload,
} from '../../../../src/indexer/interfaces/indexer.interfaces';

// ---------------------------------------------------------------------------
// Fluent Supabase mock helpers
// ---------------------------------------------------------------------------

/**
 * Creates a fluent mock chain that mirrors the Supabase client's
 * chaining API: from('table').select().eq().single(), etc.
 * Each method returns `this` by default so chains don't break.
 */
function createChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, jest.Mock> = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockResolvedValue({ error: null }),
    update: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockResolvedValue({ error: null }),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
  Object.assign(chain, overrides);
  return chain;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IndexerProcessor', () => {
  let processor: IndexerProcessor;
  let eventParser: EventParserService;

  // Per-table chains so we can assert on the right table
  let cursorChain: ReturnType<typeof createChain>;
  let loanChain: ReturnType<typeof createChain>;
  let paymentChain: ReturnType<typeof createChain>;
  let reputationHistoryChain: ReturnType<typeof createChain>;
  let reputationCacheChain: ReturnType<typeof createChain>;
  let defaultChain: ReturnType<typeof createChain>;

  const mockSupabaseClient = { from: jest.fn() };
  const mockSupabaseService = {
    getServiceRoleClient: jest.fn().mockReturnValue(mockSupabaseClient),
  };

  const mockServer = { getEvents: jest.fn() };
  const mockSorobanService = {
    getServer: jest.fn().mockReturnValue(mockServer),
  };

  const mockConfig: Record<string, string> = {
    CREDIT_LINE_CONTRACT_ID: 'C_LOAN_CONTRACT_FAKE',
    REPUTATION_CONTRACT_ID: 'C_REPUTATION_FAKE',
  };

  /** Resets all per-table chains and wires `from()` to dispatch by name. */
  function resetChains() {
    cursorChain = createChain();
    loanChain = createChain();
    paymentChain = createChain();
    reputationHistoryChain = createChain();
    reputationCacheChain = createChain();
    defaultChain = createChain();

    mockSupabaseClient.from.mockImplementation((table: string) => {
      switch (table) {
        case 'indexer_state':
          return cursorChain;
        case 'reputation_history':
          return reputationHistoryChain;
        case 'reputation_cache':
          return reputationCacheChain;
        default:
          return defaultChain;
      }
    });
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IndexerProcessor,
        EventParserService,
        { provide: SupabaseService, useValue: mockSupabaseService },
        { provide: SorobanService, useValue: mockSorobanService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => mockConfig[key] ?? ''),
          },
        },
      ],
    }).compile();

    processor = module.get(IndexerProcessor);
    eventParser = module.get(EventParserService);

    jest.clearAllMocks();
    mockSupabaseService.getServiceRoleClient.mockReturnValue(mockSupabaseClient);
    mockSorobanService.getServer.mockReturnValue(mockServer);
    resetChains();
  });

  // =========================================================================
  // Construction
  // =========================================================================

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  // =========================================================================
  // getCursor
  // =========================================================================

  describe('getCursor', () => {
    it('should return 0 when no cursor exists', async () => {
      cursorChain.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });
      expect(await processor.getCursor('C_FAKE')).toBe(0);
    });

    it('should return the stored ledger number', async () => {
      cursorChain.single.mockResolvedValue({
        data: { last_ledger: 12345 },
        error: null,
      });
      expect(await processor.getCursor('C_FAKE')).toBe(12345);
    });
  });

  // =========================================================================
  // updateCursor
  // =========================================================================

  describe('updateCursor', () => {
    it('should upsert the cursor with the new ledger', async () => {
      await processor.updateCursor('C_FAKE', 99999);

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('indexer_state');
      expect(cursorChain.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          contract_id: 'C_FAKE',
          last_ledger: 99999,
        }),
        { onConflict: 'contract_id' },
      );
    });
  });

  // =========================================================================
  // process (full job)
  // =========================================================================

  describe('process', () => {
    it('should handle empty event list gracefully', async () => {
      cursorChain.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });
      mockServer.getEvents.mockResolvedValue({ events: [], latestLedger: 100 });

      await processor.process({} as any);

      expect(mockServer.getEvents).toHaveBeenCalledTimes(2);
    });

    it('should continue indexing reputation even if loan contract fails', async () => {
      cursorChain.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });
      mockServer.getEvents
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ events: [], latestLedger: 100 });

      await expect(processor.process({} as any)).resolves.not.toThrow();
    });

    it('should skip contracts with no configured ID', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          IndexerProcessor,
          EventParserService,
          { provide: SupabaseService, useValue: mockSupabaseService },
          { provide: SorobanService, useValue: mockSorobanService },
          {
            provide: ConfigService,
            useValue: { get: jest.fn().mockReturnValue('') },
          },
        ],
      }).compile();

      const emptyProcessor = module.get(IndexerProcessor);
      mockServer.getEvents.mockClear();

      await emptyProcessor.process({} as any);

      expect(mockServer.getEvents).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Idempotency
  // =========================================================================

  describe('idempotency', () => {
    function setupSingleEventRun(
      parsedEvent: any,
    ) {
      cursorChain.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });

      const fakeRaw = {
        id: parsedEvent.eventId,
        type: 'contract',
        ledger: parsedEvent.ledgerSequence,
        ledgerClosedAt: '',
        pagingToken: '',
        inSuccessfulContractCall: true,
        topic: [],
        value: {} as any,
      };

      mockServer.getEvents.mockResolvedValue({
        events: [fakeRaw],
        latestLedger: parsedEvent.ledgerSequence,
      });

      jest.spyOn(eventParser, 'parseEvent').mockReturnValue(parsedEvent);
    }

    it('should handle duplicate LOAN_CREATED events (23505)', async () => {
      setupSingleEventRun({
        eventId: '100-0-0',
        txHash: '100-0-0',
        ledgerSequence: 100,
        type: LoanEventType.LOAN_CREATED,
        payload: {
          loanId: 'LOAN_1',
          userWallet: 'GABCDEF...',
          principalAmount: 400,
          interestAmount: 20,
          dueDate: null,
        } as LoanCreatedPayload,
      });

      loanChain.upsert.mockResolvedValue({
        error: { code: '23505', message: 'unique_violation' },
      });

      await expect(processor.process({} as any)).resolves.not.toThrow();
    });

    it('should handle duplicate LOAN_REPAID events (23505)', async () => {
      setupSingleEventRun({
        eventId: '200-1-0',
        txHash: '200-1-0',
        ledgerSequence: 200,
        type: LoanEventType.LOAN_REPAID,
        payload: {
          loanId: 'LOAN_1',
          txHash: '200-1-0',
          amount: 100,
          paidAt: '2026-03-25T00:00:00.000Z',
        } as LoanRepaidPayload,
      });

      paymentChain.insert.mockResolvedValue({
        error: { code: '23505', message: 'unique_violation' },
      });

      await expect(processor.process({} as any)).resolves.not.toThrow();
    });
  });

  // =========================================================================
  // Partial failure
  // =========================================================================

  describe('partial failure', () => {
    it('should continue processing events when one fails', async () => {
      cursorChain.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });

      const fakeEvents = [
        { id: '300-0-0', type: 'contract', ledger: 300, ledgerClosedAt: '', pagingToken: '', inSuccessfulContractCall: true, topic: [], value: {} as any },
        { id: '300-0-1', type: 'contract', ledger: 300, ledgerClosedAt: '', pagingToken: '', inSuccessfulContractCall: true, topic: [], value: {} as any },
      ];

      mockServer.getEvents.mockResolvedValue({
        events: fakeEvents,
        latestLedger: 300,
      });

      jest
        .spyOn(eventParser, 'parseEvent')
        .mockReturnValueOnce({
          eventId: '300-0-0',
          txHash: '300-0-0',
          ledgerSequence: 300,
          type: LoanEventType.LOAN_CREATED,
          payload: { loanId: 'L1', userWallet: 'G...', principalAmount: 100, interestAmount: 5, dueDate: null } as LoanCreatedPayload,
        })
        .mockReturnValueOnce({
          eventId: '300-0-1',
          txHash: '300-0-1',
          ledgerSequence: 300,
          type: LoanEventType.LOAN_DEFAULTED,
          payload: { loanId: 'L2' } as LoanDefaultedPayload,
        });

      // First upsert (LOAN_CREATED) throws a real error
      loanChain.upsert.mockRejectedValueOnce(new Error('DB write failure'));
      // Second call via update (LOAN_DEFAULTED) succeeds — but eq() needs to resolve
      loanChain.eq.mockResolvedValue({ error: null });

      await expect(processor.process({} as any)).resolves.not.toThrow();
    });
  });

  // =========================================================================
  // SCORE_CHANGED persistence
  // =========================================================================

  describe('SCORE_CHANGED event', () => {
    it('should insert into reputation_history and update reputation_cache', async () => {
      cursorChain.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });

      const fakeEvent = {
        id: '400-0-0',
        type: 'contract',
        ledger: 400,
        ledgerClosedAt: '',
        pagingToken: '',
        inSuccessfulContractCall: true,
        topic: [],
        value: {} as any,
      };

      mockServer.getEvents.mockResolvedValue({
        events: [fakeEvent],
        latestLedger: 400,
      });

      jest.spyOn(eventParser, 'parseEvent').mockReturnValue({
        eventId: '400-0-0',
        txHash: '400-0-0',
        ledgerSequence: 400,
        type: ReputationEventType.SCORE_CHANGED,
        payload: {
          wallet: 'GABCDEF...',
          oldScore: 500,
          newScore: 550,
          reason: 'Loan repayment',
        } as ScoreChangedPayload,
      });

      reputationHistoryChain.insert.mockResolvedValue({ error: null });
      reputationCacheChain.eq.mockResolvedValue({ error: null });

      await processor.process({} as any);

      // Verify reputation_history insert
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('reputation_history');
      expect(reputationHistoryChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          event_id: '400-0-0',
          user_wallet: 'GABCDEF...',
          old_score: 500,
          new_score: 550,
          change_amount: 50,
          reason: 'Loan repayment',
        }),
      );

      // Verify reputation_cache update
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('reputation_cache');
      expect(reputationCacheChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          score: 550,
        }),
      );
    });
  });
});

// ===========================================================================
// EventParserService unit tests
// ===========================================================================

describe('EventParserService', () => {
  let parser: EventParserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EventParserService],
    }).compile();
    parser = module.get(EventParserService);
  });

  it('should be defined', () => {
    expect(parser).toBeDefined();
  });

  it('should return null when parsing fails (empty topics)', () => {
    const result = parser.parseEvent({
      id: '600-0-0',
      type: 'contract' as any,
      ledger: 600,
      ledgerClosedAt: '',
      pagingToken: '',
      inSuccessfulContractCall: true,
      topic: [], // empty topics → scValToString will throw/return ''
      value: {} as any,
    } as any);

    expect(result).toBeNull();
  });

  it('should return null for unrecognised event types', () => {
    // Spy on the private scValToString via parseEvent's path.
    // We use a topic array with a value that scValToNative will fail to decode,
    // causing the helper to return '' which is an "unrecognised" type.
    const result = parser.parseEvent({
      id: '700-0-0',
      type: 'contract' as any,
      ledger: 700,
      ledgerClosedAt: '',
      pagingToken: '',
      inSuccessfulContractCall: true,
      topic: ['not-a-real-scval' as any],
      value: {} as any,
    } as any);

    // Will return null because '' or invalid string doesn't match any known event
    expect(result).toBeNull();
  });
});
