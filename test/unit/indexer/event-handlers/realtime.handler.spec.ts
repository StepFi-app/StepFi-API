import { Test, TestingModule } from '@nestjs/testing';
import { RealtimeEventHandler } from '../../../../src/indexer/event-handlers/realtime.handler';
import { RealtimeService } from '../../../../src/realtime/realtime.service';

describe('RealtimeEventHandler', () => {
  let handler: RealtimeEventHandler;
  let service: RealtimeService;

  const mockRealtimeService = {
    broadcastLoanStatusChanged: jest.fn(),
    broadcastPaymentConfirmed: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeEventHandler,
        {
          provide: RealtimeService,
          useValue: mockRealtimeService,
        },
      ],
    }).compile();

    handler = module.get<RealtimeEventHandler>(RealtimeEventHandler);
    service = module.get<RealtimeService>(RealtimeService);
  });

  it('should be defined', () => {
    expect(handler).toBeDefined();
  });

  it('should handle LOAN_CREATED and trigger broadcastLoanStatusChanged', () => {
    const mockEvent = {
      eventId: 'evt123',
      payload: {
        loanId: 'loan123',
        userWallet: 'wallet123',
        principalAmount: 1000,
        interestAmount: 50,
        dueDate: '2026-08-18',
      },
    } as any;

    handler.handleLoanCreated(mockEvent);

    expect(service.broadcastLoanStatusChanged).toHaveBeenCalledWith('loan123', 'active', {
      userWallet: 'wallet123',
      principalAmount: '1000',
      interestAmount: '50',
      dueDate: '2026-08-18',
    });
  });

  it('should handle LOAN_REPAID and trigger payment/status broadcasts', () => {
    const mockEvent = {
      eventId: 'evt123',
      payload: {
        loanId: 'loan123',
        txHash: 'tx123',
        amount: 200,
        paidAt: '2026-07-18T10:00:00Z',
      },
    } as any;

    handler.handleLoanRepaid(mockEvent, 'paid');

    expect(service.broadcastPaymentConfirmed).toHaveBeenCalledWith(
      'loan123',
      'tx123',
      '200',
      '2026-07-18T10:00:00Z',
    );
    expect(service.broadcastLoanStatusChanged).toHaveBeenCalledWith('loan123', 'paid');
  });

  it('should handle LOAN_DEFAULTED and trigger broadcastLoanStatusChanged', () => {
    const mockEvent = {
      eventId: 'evt123',
      payload: {
        loanId: 'loan123',
      },
    } as any;

    handler.handleLoanDefaulted(mockEvent);

    expect(service.broadcastLoanStatusChanged).toHaveBeenCalledWith('loan123', 'defaulted');
  });
});
