import { Test, TestingModule } from '@nestjs/testing';
import { LoansController } from '../../../../src/modules/loans/loans.controller';
import { LoansService } from '../../../../src/modules/loans/loans.service';
import { BlockchainService } from '../../../../src/modules/blockchain/blockchain.service';
import { CreateLoanResponseDto } from '../../../../src/modules/loans/dto/create-loan-response.dto';
import { LoanListStatusFilter } from '../../../../src/modules/loans/dto/loan-list-query.dto';

describe('LoansController', () => {
  let controller: LoansController;
  let loansService: LoansService;

  const validWallet = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
  const currentUser = { wallet: validWallet };

  const mockQuoteResponse = {
    amount: 500,
    guarantee: 100,
    loanAmount: 400,
    interestRate: 8,
    totalRepayment: 410.67,
    term: 4,
    schedule: [
      { paymentNumber: 1, amount: 102.66, dueDate: '2026-03-13T00:00:00.000Z' },
      { paymentNumber: 2, amount: 102.66, dueDate: '2026-04-13T00:00:00.000Z' },
      { paymentNumber: 3, amount: 102.66, dueDate: '2026-05-13T00:00:00.000Z' },
      { paymentNumber: 4, amount: 102.69, dueDate: '2026-06-13T00:00:00.000Z' },
    ],
  };

  const mockLoansService = {
    calculateLoanQuote: jest.fn(),
    getAvailableCredit: jest.fn(),
    createLoan: jest.fn(),
    getMyLoans: jest.fn(),
    assessLoan: jest.fn(),
  };

  const mockCreateLoanResponse: CreateLoanResponseDto = {
    loanId: 'pending-1711180800000-ab12cd34',
    xdr: 'AAAAAgAAAAC...',
    description: 'Create BNPL loan for $500 at TechStore',
    terms: mockQuoteResponse as any,
    assessment: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LoansController],
      providers: [
        { provide: LoansService, useValue: mockLoansService },
        { provide: BlockchainService, useValue: {} },
      ],
    }).compile();

    controller = module.get<LoansController>(LoansController);
    loansService = module.get<LoansService>(LoansService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getLoanQuote', () => {
    const validDto = {
      amount: 500,
      vendor: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      term: 4,
    };

    it('should return a loan quote wrapped in response envelope', async () => {
      mockLoansService.calculateLoanQuote.mockResolvedValue(mockQuoteResponse);

      const result = await controller.getLoanQuote(currentUser, validDto);

      expect(result).toEqual({
        success: true,
        data: mockQuoteResponse,
        message: 'Loan quote calculated successfully',
      });
      expect(loansService.calculateLoanQuote).toHaveBeenCalledWith(validWallet, validDto);
      expect(loansService.calculateLoanQuote).toHaveBeenCalledTimes(1);
    });

    it('should propagate service errors to the caller', async () => {
      mockLoansService.calculateLoanQuote.mockRejectedValue(new Error('Reputation fetch failed'));

      await expect(controller.getLoanQuote(currentUser, validDto)).rejects.toThrow(
        'Reputation fetch failed',
      );
    });
  });

  describe('createLoan', () => {
    const validDto = {
      amount: 500,
      vendor: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      term: 4,
    };

    it('should return a created loan response wrapped in response envelope', async () => {
      mockLoansService.createLoan.mockResolvedValue(mockCreateLoanResponse);

      const result = await controller.createLoan(currentUser, validDto);

      expect(result).toEqual({
        success: true,
        data: mockCreateLoanResponse,
        message: 'Pending loan created successfully',
      });
      expect(loansService.createLoan).toHaveBeenCalledWith(validWallet, validDto);
      expect(loansService.createLoan).toHaveBeenCalledTimes(1);
    });

    it('should propagate service errors to the caller', async () => {
      mockLoansService.createLoan.mockRejectedValue(new Error('XDR construction failed'));

      await expect(controller.createLoan(currentUser, validDto)).rejects.toThrow(
        'XDR construction failed',
      );
    });
  });

  describe('getAvailableCredit', () => {
    const mockAvailableCreditResponse = {
      reputationScore: 75,
      reputationTier: 'silver' as const,
      maxCreditLimit: 3000,
      creditUsed: 825.5,
      availableCredit: 2174.5,
      activeLoans: 2,
    };

    it('should return the available credit wrapped in response envelope', async () => {
      mockLoansService.getAvailableCredit.mockResolvedValue(mockAvailableCreditResponse);

      const user = { wallet: validWallet };
      const result = await controller.getAvailableCredit(user);

      expect(result).toEqual({
        success: true,
        data: mockAvailableCreditResponse,
        message: 'Available credit calculated successfully',
      });
      expect(loansService.getAvailableCredit).toHaveBeenCalledWith(validWallet);
      expect(loansService.getAvailableCredit).toHaveBeenCalledTimes(1);
    });

    it('should propagate service errors to the caller', async () => {
      mockLoansService.getAvailableCredit.mockRejectedValue(
        new Error('Reputation contract unavailable'),
      );

      const user = { wallet: validWallet };
      await expect(controller.getAvailableCredit(user)).rejects.toThrow(
        'Reputation contract unavailable',
      );
    });
  });

  describe('assessLoan', () => {
    const loanId = '11111111-2222-3333-4444-555555555555';

    const mockAssessResponse = {
      loanId: 'chain-loan-1',
      assessment: {
        decision: 'approved',
        score: 85,
        reasons: ['Strong reputation score of 85 with sufficient available credit'],
      },
      previousStatus: 'pending',
      currentStatus: 'pending',
    };

    it('should assess a loan and return the result', async () => {
      mockLoansService.assessLoan.mockResolvedValue(mockAssessResponse);

      const result = await controller.assessLoan(currentUser, loanId);

      expect(result).toEqual({
        success: true,
        data: mockAssessResponse,
        message: 'Loan assessment completed successfully',
      });
      expect(loansService.assessLoan).toHaveBeenCalledWith(validWallet, loanId);
      expect(loansService.assessLoan).toHaveBeenCalledTimes(1);
    });

    it('should propagate service errors to the caller', async () => {
      mockLoansService.assessLoan.mockRejectedValue(new Error('Loan not found'));

      await expect(controller.assessLoan(currentUser, loanId)).rejects.toThrow('Loan not found');
    });
  });

  describe('getMyLoans', () => {
    const mockLoanListResponse = {
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
            id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
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
    };

    it('should return user loans wrapped in the response envelope', async () => {
      const query = { status: LoanListStatusFilter.ACTIVE, limit: 20, offset: 0 };
      mockLoansService.getMyLoans.mockResolvedValue(mockLoanListResponse);

      const result = await controller.getMyLoans(currentUser, query);

      expect(result).toEqual({
        success: true,
        ...mockLoanListResponse,
      });
      expect(loansService.getMyLoans).toHaveBeenCalledWith(validWallet, query);
      expect(loansService.getMyLoans).toHaveBeenCalledTimes(1);
    });

    it('should propagate service errors to the caller', async () => {
      mockLoansService.getMyLoans.mockRejectedValue(new Error('Failed to retrieve user loans'));

      await expect(controller.getMyLoans(currentUser, {})).rejects.toThrow(
        'Failed to retrieve user loans',
      );
    });
  });
});
