import { Test, TestingModule } from '@nestjs/testing';
import { RealtimeService } from '../../../src/realtime/realtime.service';
import { RealtimeGateway } from '../../../src/realtime/realtime.gateway';

describe('RealtimeService', () => {
  let service: RealtimeService;
  let gateway: RealtimeGateway;

  const mockRealtimeGateway = {
    broadcast: jest.fn(),
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
      ],
    }).compile();

    service = module.get<RealtimeService>(RealtimeService);
    gateway = module.get<RealtimeGateway>(RealtimeGateway);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should broadcast loan status change events correctly', () => {
    const loanId = 'loan123';
    const status = 'paid';
    const details = { userWallet: 'wallet123', amount: 100 };

    service.broadcastLoanStatusChanged(loanId, status, details);

    expect(gateway.broadcast).toHaveBeenCalledWith('loan.status_changed', {
      loanId,
      status,
      userWallet: 'wallet123',
      amount: 100,
    });
  });

  it('should broadcast payment confirmed events correctly', () => {
    const loanId = 'loan123';
    const txHash = 'tx123';
    const amount = '50';
    const paidAt = '2026-07-18T00:00:00Z';

    service.broadcastPaymentConfirmed(loanId, txHash, amount, paidAt);

    expect(gateway.broadcast).toHaveBeenCalledWith('payment.confirmed', {
      loanId,
      txHash,
      amount,
      paidAt,
    });
  });
});
