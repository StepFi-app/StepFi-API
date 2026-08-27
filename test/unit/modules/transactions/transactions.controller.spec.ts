import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { TransactionsController } from '../../../../src/modules/transactions/transactions.controller';
import { TransactionType } from '../../../../src/modules/transactions/dto/submit-transaction-request.dto';
import { TransactionsService } from '../../../../src/modules/transactions/transactions.service';

describe('TransactionsController', () => {
  let controller: TransactionsController;
  let transactionsService: TransactionsService;

  const validWallet = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
  const validHash = 'a'.repeat(64);

  const mockTransactionsService = {
    submitTransaction: jest.fn(),
    getTransactionStatus: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 1000 }])],
      controllers: [TransactionsController],
      // The WalletThrottlerGuard on the submit route needs the throttler
      // options/storage provided by ThrottlerModule above; the JWT guard is
      // resolved by passport and needs no providers here.
      providers: [{ provide: TransactionsService, useValue: mockTransactionsService }],
    }).compile();

    controller = module.get<TransactionsController>(TransactionsController);
    transactionsService = module.get<TransactionsService>(TransactionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('submitTransaction', () => {
    it('should wrap the submission response in the standard envelope', async () => {
      const dto = { xdr: 'AAAAAg...', type: TransactionType.DEPOSIT };
      const data = { transactionHash: validHash, status: 'pending' as const };
      mockTransactionsService.submitTransaction.mockResolvedValue(data);

      const result = await controller.submitTransaction({ wallet: validWallet }, dto);

      expect(result).toEqual({
        success: true,
        data,
        message: 'Transaction submitted successfully',
      });
      expect(transactionsService.submitTransaction).toHaveBeenCalledWith(validWallet, dto);
    });
  });

  describe('getTransactionStatus', () => {
    it('should return the public transaction lookup in the standard envelope', async () => {
      const data = {
        hash: validHash,
        status: 'success' as const,
        type: 'loan_repay',
        result: {
          ledger: 123,
          operationCount: 1,
          sourceAccount: validWallet,
          feeCharged: '100',
          memoType: 'none',
          memo: null,
          createdAt: '2026-03-23T05:15:30Z',
        },
        error: null,
        submittedAt: '2026-03-23T05:15:00.000Z',
        confirmedAt: '2026-03-23T05:15:30Z',
        lastCheckedAt: '2026-03-23T05:16:00.000Z',
      };
      mockTransactionsService.getTransactionStatus.mockResolvedValue(data);

      const result = await controller.getTransactionStatus(validHash);

      expect(result).toEqual({
        success: true,
        data,
        message: 'Transaction status retrieved successfully',
      });
      expect(transactionsService.getTransactionStatus).toHaveBeenCalledWith(validHash);
    });

    it('should reject invalid hashes before calling the service', async () => {
      await expect(controller.getTransactionStatus('not-a-hash')).rejects.toThrow(
        BadRequestException,
      );
      expect(transactionsService.getTransactionStatus).not.toHaveBeenCalled();
    });
  });
});
