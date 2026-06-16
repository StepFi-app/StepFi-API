import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LoansService } from '../../../../src/modules/loans/loans.service';
import { ReputationService } from '../../../../src/modules/reputation/reputation.service';
import { SupabaseService } from '../../../../src/database/supabase.client';
import { CreditLineContractClient } from '../../../../src/stellar/contracts/clients/creditline.client';
import { ReputationContractClient } from '../../../../src/stellar/contracts/clients/reputation.client';
import { MockCreditLineContractClient } from '../../../../src/stellar/contracts/mocks/creditline.mock';
import { MockReputationContractClient } from '../../../../src/stellar/contracts/mocks/reputation.mock';
import { LoanListStatusFilter } from '../../../../src/modules/loans/dto/loan-list-query.dto';

describe('LoansService', () => {
  let service: LoansService;
  let mockCreditLineContractClient: MockCreditLineContractClient;
  let mockReputationContractClient: MockReputationContractClient;

  const validWallet = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
  const vendorId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  const mockReputationService = {
    getReputationScore: jest.fn(),
  };

  const mockSupabaseFrom = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
    single: jest.fn(),
    insert: jest.fn(),
  };

  const mockSupabaseClient = {
    from: jest.fn().mockReturnValue(mockSupabaseFrom),
  };

  const mockSupabaseService = {
    getServiceRoleClient: jest.fn().mockReturnValue(mockSupabaseClient),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoansService,
        { provide: ReputationService, useValue: mockReputationService },
        { provide: SupabaseService, useValue: mockSupabaseService },
        { provide: CreditLineContractClient, useClass: MockCreditLineContractClient },
        { provide: ReputationContractClient, useClass: MockReputationContractClient },
      ],
    }).compile();

    service = module.get<LoansService>(LoansService);
    mockCreditLineContractClient = module.get<MockCreditLineContractClient>(CreditLineContractClient);
    mockReputationContractClient = module.get<MockReputationContractClient>(ReputationContractClient);
    jest.clearAllMocks();

    mockSupabaseClient.from.mockReturnValue(mockSupabaseFrom);
    mockSupabaseFrom.select.mockReturnThis();
    mockSupabaseFrom.eq.mockReturnThis();
    mockSupabaseFrom.in.mockReturnThis();
    mockSupabaseFrom.order.mockReturnThis();
    mockSupabaseFrom.range.mockReturnThis();
    mockSupabaseFrom.insert.mockResolvedValue({ error: null });
    mockCreditLineContractClient.buildCreateLoanTransaction.mockResolvedValue('AAAAAgAAAAC...');
    mockCreditLineContractClient.buildRepayLoanTx.mockResolvedValue('AAAAAgAAAAA...');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('calculateLoanQuote', () => {
    const baseDto = { amount: 500, vendor: vendorId, term: 4 };

    function mockReputation(score: number, tier: string, interestRate: number, maxCredit: number) {
      mockReputationService.getReputationScore.mockResolvedValue({
        wallet: validWallet,
        score,
        tier,
        interestRate,
        maxCredit,
        lastUpdated: '2026-02-13T10:00:00.000Z',
      });
    }

    function mockVendorFound(isActive = true) {
      mockSupabaseFrom.single.mockResolvedValue({
        data: { id: vendorId, name: 'TechStore', verified: isActive },
        error: null,
      });
    }

    function mockVendorNotFound() {
      mockSupabaseFrom.single.mockResolvedValue({
        data: null,
        error: { message: 'not found' },
      });
    }

    it('should calculate a quote for a gold tier user', async () => {
      mockReputation(95, 'gold', 5, 7500);
      mockVendorFound();

      const result = await service.calculateLoanQuote(validWallet, baseDto);

      expect(result.amount).toBe(500);
      expect(result.guarantee).toBe(100);
      expect(result.loanAmount).toBe(400);
      expect(result.interestRate).toBe(5);
      expect(result.term).toBe(4);
      expect(result.totalRepayment).toBeGreaterThan(400);
      expect(result.schedule).toHaveLength(4);
    });

    it('should calculate a quote for a silver tier user', async () => {
      mockReputation(75, 'silver', 8, 2000);
      mockVendorFound();

      const result = await service.calculateLoanQuote(validWallet, baseDto);

      expect(result.interestRate).toBe(8);
      expect(result.loanAmount).toBe(400);
      expect(result.totalRepayment).toBeCloseTo(410.67, 1);
    });

    it('should calculate a quote for a bronze tier user', async () => {
      mockReputation(65, 'bronze', 9, 1500);
      mockVendorFound();

      const result = await service.calculateLoanQuote(validWallet, baseDto);

      expect(result.interestRate).toBe(9);
      expect(result.guarantee).toBe(100);
      expect(result.loanAmount).toBe(400);
    });

    it('should calculate a quote for a poor tier user', async () => {
      mockReputation(40, 'poor', 12, 700);
      mockVendorFound();

      const result = await service.calculateLoanQuote(validWallet, {
        ...baseDto,
        amount: 200,
      });

      expect(result.interestRate).toBe(12);
      expect(result.guarantee).toBe(40);
      expect(result.loanAmount).toBe(160);
    });

    it('should reject amount exceeding max credit', async () => {
      mockReputation(40, 'poor', 12, 300);
      mockVendorFound();

      await expect(service.calculateLoanQuote(validWallet, baseDto)).rejects.toThrow(
        BadRequestException,
      );

      await expect(service.calculateLoanQuote(validWallet, baseDto)).rejects.toMatchObject({
        response: { code: 'LOAN_AMOUNT_EXCEEDS_CREDIT' },
      });
    });

    it('should throw NotFoundException when vendor does not exist', async () => {
      mockReputation(75, 'silver', 8, 2000);
      mockVendorNotFound();

      await expect(service.calculateLoanQuote(validWallet, baseDto)).rejects.toThrow(
        NotFoundException,
      );

      await expect(service.calculateLoanQuote(validWallet, baseDto)).rejects.toMatchObject({
        response: { code: 'VENDOR_NOT_FOUND' },
      });
    });

    it('should throw BadRequestException when vendor is not verified', async () => {
      mockReputation(75, 'silver', 8, 2000);
      mockVendorFound(false);

      await expect(service.calculateLoanQuote(validWallet, baseDto)).rejects.toThrow(
        BadRequestException,
      );

      await expect(service.calculateLoanQuote(validWallet, baseDto)).rejects.toMatchObject({
        response: { code: 'VENDOR_NOT_VERIFIED' },
      });
    });

    it('should set guarantee to 20% and loan to 80% of amount', async () => {
      mockReputation(90, 'gold', 5, 10000);
      mockVendorFound();

      const result = await service.calculateLoanQuote(validWallet, {
        ...baseDto,
        amount: 1000,
      });

      expect(result.guarantee).toBe(200);
      expect(result.loanAmount).toBe(800);
    });

    it('should handle fractional amounts correctly', async () => {
      mockReputation(90, 'gold', 4, 10000);
      mockVendorFound();

      const result = await service.calculateLoanQuote(validWallet, {
        ...baseDto,
        amount: 333,
        term: 3,
      });

      expect(result.guarantee).toBeCloseTo(66.6, 1);
      expect(result.loanAmount).toBeCloseTo(266.4, 1);
      expect(result.totalRepayment).toBeGreaterThan(result.loanAmount);
    });
  });

  describe('createLoan', () => {
    const baseDto = { amount: 500, vendor: vendorId, term: 4 };

    function mockReputation(score: number, tier: string, interestRate: number, maxCredit: number) {
      mockReputationService.getReputationScore.mockResolvedValue({
        wallet: validWallet,
        score,
        tier,
        interestRate,
        maxCredit,
        lastUpdated: '2026-02-13T10:00:00.000Z',
      });
    }

    function mockVendorFound(isActive = true) {
      mockSupabaseFrom.single.mockResolvedValue({
        data: { id: vendorId, name: 'TechStore', verified: isActive },
        error: null,
      });
    }

    it('should create a pending loan with XDR and terms', async () => {
      mockReputation(75, 'silver', 8, 2000);
      mockVendorFound();

      const result = await service.createLoan(validWallet, baseDto);

      expect(result.loanId).toContain('pending-');
      expect(result.xdr).toBe('AAAAAgAAAAC...');
      expect(result.description).toBe('Create BNPL loan for $500 at TechStore');
      expect(result.terms.guarantee).toBe(100);
      expect(mockCreditLineContractClient.buildCreateLoanTransaction).toHaveBeenCalled();
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('loans');
      expect(mockSupabaseFrom.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_wallet: validWallet,
          vendor_id: vendorId,
          status: 'pending',
          next_payment_due: expect.any(String),
        }),
      );
    });

    it('should reject loan creation when reputation is below minimum threshold', async () => {
      mockReputation(59, 'poor', 12, 500);
      mockVendorFound();

      await expect(service.createLoan(validWallet, { ...baseDto, amount: 200 })).rejects.toMatchObject(
        {
          response: { code: 'LOAN_REPUTATION_TOO_LOW' },
        },
      );
    });

    it('should throw InternalServerErrorException when XDR construction fails', async () => {
      mockReputation(75, 'silver', 8, 2000);
      mockVendorFound();
      mockCreditLineContractClient.buildCreateLoanTransaction.mockRejectedValue(
        new Error('Soroban unavailable'),
      );

      await expect(service.createLoan(validWallet, baseDto)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should throw InternalServerErrorException when pending loan persistence fails', async () => {
      mockReputation(75, 'silver', 8, 2000);
      mockVendorFound();
      mockSupabaseFrom.insert.mockResolvedValue({
        error: { message: 'insert failed' },
      });

      await expect(service.createLoan(validWallet, baseDto)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('repayLoan', () => {
    const loanId = '11111111-2222-3333-4444-555555555555';

    function mockActiveLoan(overrides: Record<string, unknown> = {}) {
      mockSupabaseFrom.single.mockResolvedValue({
        data: {
          id: loanId,
          loan_id: 'chain-loan-1',
          user_wallet: validWallet,
          status: 'active',
          remaining_balance: 325,
          ...overrides,
        },
        error: null,
      });
    }

    it('should return unsigned XDR and payment preview', async () => {
      mockActiveLoan();

      const result = await service.repayLoan(validWallet, loanId, { amount: 108.33 });

      expect(result).toEqual({
        unsignedXdr: 'AAAAAgAAAAA...',
        preview: {
          paymentAmount: 108.33,
          currentBalance: 325,
          newBalance: 216.67,
          willComplete: false,
        },
      });
      expect(mockCreditLineContractClient.buildRepayLoanTx).toHaveBeenCalledWith(
        validWallet,
        'chain-loan-1',
        108.33,
      );
    });

    it('should throw NotFoundException when loan does not exist', async () => {
      mockSupabaseFrom.single.mockResolvedValue({
        data: null,
        error: { message: 'not found' },
      });

      await expect(service.repayLoan(validWallet, loanId, { amount: 50 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when loan belongs to another user', async () => {
      mockActiveLoan({ user_wallet: 'GOTHERWALLETABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFG' });

      await expect(service.repayLoan(validWallet, loanId, { amount: 50 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when loan is not active', async () => {
      mockActiveLoan({ status: 'pending' });

      await expect(service.repayLoan(validWallet, loanId, { amount: 50 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when payment exceeds balance', async () => {
      mockActiveLoan({ remaining_balance: 25 });

      await expect(service.repayLoan(validWallet, loanId, { amount: 50 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should mark payment as completing the loan when balance reaches zero', async () => {
      mockActiveLoan({ remaining_balance: 108.33 });

      const result = await service.repayLoan(validWallet, loanId, { amount: 108.33 });

      expect(result.preview.willComplete).toBe(true);
      expect(result.preview.newBalance).toBe(0);
    });
  });

  describe('generateSchedule', () => {
    it('should generate correct number of payments', () => {
      const schedule = service.generateSchedule(400, 4);
      expect(schedule).toHaveLength(4);
    });

    it('should have sequential payment numbers', () => {
      const schedule = service.generateSchedule(600, 3);
      expect(schedule.map((p) => p.paymentNumber)).toEqual([1, 2, 3]);
    });

    it('should sum to totalRepayment exactly', () => {
      const total = 410.67;
      const schedule = service.generateSchedule(total, 4);
      const sum = schedule.reduce((acc, p) => acc + p.amount, 0);
      expect(Math.round(sum * 100) / 100).toBe(total);
    });

    it('should have due dates 30 days apart (monthly)', () => {
      const schedule = service.generateSchedule(300, 3);

      for (let i = 0; i < schedule.length; i++) {
        const dueDate = new Date(schedule[i].dueDate);
        expect(dueDate.getHours()).toBe(0);
        expect(dueDate.getMinutes()).toBe(0);
        expect(dueDate.getSeconds()).toBe(0);
      }

      const d1 = new Date(schedule[0].dueDate);
      const d2 = new Date(schedule[1].dueDate);
      const diffDays = (d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThanOrEqual(28);
      expect(diffDays).toBeLessThanOrEqual(31);
    });

    it('should handle single payment term', () => {
      const schedule = service.generateSchedule(500, 1);
      expect(schedule).toHaveLength(1);
      expect(schedule[0].amount).toBe(500);
      expect(schedule[0].paymentNumber).toBe(1);
    });

    it('should handle rounding remainder in last payment', () => {
      const schedule = service.generateSchedule(100, 3);
      const sum = schedule.reduce((acc, p) => acc + p.amount, 0);
      expect(Math.round(sum * 100) / 100).toBe(100);
    });

    it('should return valid ISO date strings', () => {
      const schedule = service.generateSchedule(200, 2);
      for (const payment of schedule) {
        expect(() => new Date(payment.dueDate)).not.toThrow();
        expect(new Date(payment.dueDate).toISOString()).toBe(payment.dueDate);
      }
    });
  });

  describe('getAvailableCredit', () => {
    beforeEach(() => {
      mockReputationContractClient.getScore.mockResolvedValue(75);
    });

    it('should calculate available credit from on-chain score and active loans', async () => {
      mockSupabaseFrom.eq
        .mockImplementationOnce(() => mockSupabaseFrom)
        .mockResolvedValueOnce({
          data: [{ remaining_balance: 400.25 }, { remaining_balance: 125.25 }],
          error: null,
        });

      const result = await service.getAvailableCredit(validWallet);

      expect(result).toEqual({
        reputationScore: 75,
        reputationTier: 'silver',
        maxCreditLimit: 3000,
        creditUsed: 525.5,
        availableCredit: 2474.5,
        activeLoans: 2,
      });
      expect(mockReputationContractClient.getScore).toHaveBeenCalledWith(validWallet);
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('loans');
      expect(mockSupabaseFrom.select).toHaveBeenCalledWith('remaining_balance');
    });

    it('should treat missing on-chain score as zero reputation', async () => {
      mockReputationContractClient.getScore.mockResolvedValue(null);
      mockSupabaseFrom.eq
        .mockImplementationOnce(() => mockSupabaseFrom)
        .mockResolvedValueOnce({
          data: [],
          error: null,
        });

      const result = await service.getAvailableCredit(validWallet);

      expect(result).toEqual({
        reputationScore: 0,
        reputationTier: 'poor',
        maxCreditLimit: 500,
        creditUsed: 0,
        availableCredit: 500,
        activeLoans: 0,
      });
    });

    it('should never return negative available credit', async () => {
      mockReputationContractClient.getScore.mockResolvedValue(60);
      mockSupabaseFrom.eq
        .mockImplementationOnce(() => mockSupabaseFrom)
        .mockResolvedValueOnce({
          data: [{ remaining_balance: 800 }, { remaining_balance: 900 }],
          error: null,
        });

      const result = await service.getAvailableCredit(validWallet);

      expect(result.availableCredit).toBe(0);
      expect(result.creditUsed).toBe(1700);
      expect(result.maxCreditLimit).toBe(1500);
    });

    it('should throw ServiceUnavailableException when blockchain lookup fails', async () => {
      mockReputationContractClient.getScore.mockRejectedValue(new Error('rpc timeout'));

      await expect(service.getAvailableCredit(validWallet)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('should throw InternalServerErrorException when active loans query fails', async () => {
      mockSupabaseFrom.eq
        .mockImplementationOnce(() => mockSupabaseFrom)
        .mockResolvedValueOnce({
          data: null,
          error: { message: 'db offline' },
        });

      await expect(service.getAvailableCredit(validWallet)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('getMyLoans', () => {
    beforeEach(() => {
      mockSupabaseFrom.eq.mockImplementation((column: string, value: unknown) => {
        if (column === 'status' && value === LoanListStatusFilter.ACTIVE) {
          return Promise.resolve({
            data: [
              {
                id: '11111111-2222-3333-4444-555555555555',
                loan_id: 'chain-loan-1',
                vendor_id: vendorId,
                amount: 500,
                loan_amount: 400,
                guarantee: 100,
                interest_rate: 8,
                total_repayment: 410.67,
                remaining_balance: 205.33,
                term: 4,
                status: 'active',
                next_payment_due: '2026-04-13T00:00:00.000Z',
                created_at: '2026-03-13T00:00:00.000Z',
                completed_at: null,
                defaulted_at: null,
                vendors: {
                  id: vendorId,
                  name: 'TechStore',
                },
                loan_payments: [{ amount: 102.66 }, { amount: 102.68 }],
              },
            ],
            error: null,
            count: 1,
          });
        }

        return mockSupabaseFrom;
      });

      mockSupabaseFrom.in.mockResolvedValue({
        data: [],
        error: null,
        count: 0,
      });
    });

    it('should return paginated loans with derived totals and next payment details', async () => {
      const result = await service.getMyLoans(validWallet, {
        status: LoanListStatusFilter.ACTIVE,
        limit: 20,
        offset: 0,
      });

      expect(result).toEqual({
        data: [
          {
            id: '11111111-2222-3333-4444-555555555555',
            loanId: 'chain-loan-1',
            amount: 500,
            loanAmount: 400,
            guarantee: 100,
            interestRate: 8,
            totalRepayment: 410.67,
            totalPaid: 205.34,
            remainingBalance: 205.33,
            term: 4,
            status: LoanListStatusFilter.ACTIVE,
            vendor: {
              id: vendorId,
              name: 'TechStore',
            },
            nextPayment: {
              dueDate: '2026-04-13T00:00:00.000Z',
              amount: 102.66,
            },
            createdAt: '2026-03-13T00:00:00.000Z',
            completedAt: null,
            defaultedAt: null,
          },
        ],
        pagination: {
          limit: 20,
          offset: 0,
          total: 1,
        },
      });
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('loans');
      expect(mockSupabaseFrom.order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(mockSupabaseFrom.range).toHaveBeenCalledWith(0, 19);
    });

    it('should return an empty paginated result when the user has no indexed loans', async () => {
      const result = await service.getMyLoans(validWallet, { limit: 10, offset: 0 });

      expect(result).toEqual({
        data: [],
        pagination: {
          limit: 10,
          offset: 0,
          total: 0,
        },
      });
      expect(mockSupabaseFrom.in).toHaveBeenCalledWith('status', [
        LoanListStatusFilter.ACTIVE,
        LoanListStatusFilter.COMPLETED,
        LoanListStatusFilter.DEFAULTED,
      ]);
    });

    it('should throw InternalServerErrorException when the loans query fails', async () => {
      mockSupabaseFrom.eq.mockImplementation((column: string, value: unknown) => {
        if (column === 'status' && value === LoanListStatusFilter.DEFAULTED) {
          return Promise.resolve({
            data: null,
            error: { message: 'db offline' },
            count: null,
          });
        }

        return mockSupabaseFrom;
      });

      await expect(
        service.getMyLoans(validWallet, {
          status: LoanListStatusFilter.DEFAULTED,
          limit: 20,
          offset: 0,
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
