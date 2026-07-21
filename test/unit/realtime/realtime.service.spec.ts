import { Test, TestingModule } from '@nestjs/testing';
import { RealtimeService } from '../../../src/realtime/realtime.service';
import { RealtimeGateway } from '../../../src/realtime/realtime.gateway';
import { SupabaseService } from '../../../src/database/supabase.client';

describe('RealtimeService', () => {
  let service: RealtimeService;
  let gateway: RealtimeGateway;

  const mockRealtimeGateway = {
    sendToUser: jest.fn(),
  };

  const mockSupabaseFrom = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({
      data: { user_wallet: 'wallet123' },
      error: null,
    }),
  };

  const mockSupabaseClient = {
    from: jest.fn().mockReturnValue(mockSupabaseFrom),
  };

  const mockSupabaseService = {
    getServiceRoleClient: jest.fn().mockReturnValue(mockSupabaseClient),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeService,
        {
          provide: RealtimeGateway,
          useValue: mockRealtimeGateway,
        },
        {
          provide: SupabaseService,
          useValue: mockSupabaseService,
        },
      ],
    }).compile();

    service = module.get<RealtimeService>(RealtimeService);
    gateway = module.get<RealtimeGateway>(RealtimeGateway);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should send loan status change events to the correct wallet address (provided wallet)', async () => {
    const loanId = 'loan123';
    const status = 'active';
    const details = { userWallet: 'wallet123', amount: 100 };

    await service.broadcastLoanStatusChanged(loanId, status, details);

    expect(gateway.sendToUser).toHaveBeenCalledWith('wallet123', 'loan.status_changed', {
      loanId,
      status,
      userWallet: 'wallet123',
      amount: 100,
    });
  });

  it('should send loan status change events to resolved wallet address from database when details is empty', async () => {
    const loanId = 'loan123';
    const status = 'defaulted';

    await service.broadcastLoanStatusChanged(loanId, status);

    expect(mockSupabaseClient.from).toHaveBeenCalledWith('loans');
    expect(gateway.sendToUser).toHaveBeenCalledWith('wallet123', 'loan.status_changed', {
      loanId,
      status,
    });
  });

  it('should send payment confirmed events to the resolved database wallet address', async () => {
    const loanId = 'loan123';
    const txHash = 'tx123';
    const amount = '50';
    const paidAt = '2026-07-18T00:00:00Z';

    await service.broadcastPaymentConfirmed(loanId, txHash, amount, paidAt);

    expect(mockSupabaseClient.from).toHaveBeenCalledWith('loans');
    expect(gateway.sendToUser).toHaveBeenCalledWith('wallet123', 'payment.confirmed', {
      loanId,
      txHash,
      amount,
      paidAt,
    });
  });
});
