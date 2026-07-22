import { Test, TestingModule } from '@nestjs/testing';
import { StellarService } from '../../../src/stellar/stellar.service';
import { HorizonClientService } from '../../../src/stellar/horizon-client.service';

describe('StellarService', () => {
  let service: StellarService;
  let horizonClientService: HorizonClientService;

  const mockHorizonClientService = {
    getNetworkPassphrase: jest.fn(),
    getEndpointStatuses: jest.fn(),
    getRoot: jest.fn(),
    submitTransaction: jest.fn(),
    getTransaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StellarService,
        {
          provide: HorizonClientService,
          useValue: mockHorizonClientService,
        },
      ],
    }).compile();

    service = module.get<StellarService>(StellarService);
    horizonClientService = module.get<HorizonClientService>(HorizonClientService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should delegate getNetworkPassphrase to horizonClientService', () => {
    mockHorizonClientService.getNetworkPassphrase.mockReturnValue('Test SDF Network ; September 2015');
    const result = service.getNetworkPassphrase();
    expect(result).toBe('Test SDF Network ; September 2015');
    expect(horizonClientService.getNetworkPassphrase).toHaveBeenCalledTimes(1);
  });

  it('should delegate getEndpointStatuses to horizonClientService', () => {
    const mockStatuses = [
      { url: 'https://horizon.stellar.org', status: 'closed', failureCount: 0, lastFailure: null, isPrimary: true },
    ] as any[];
    mockHorizonClientService.getEndpointStatuses.mockReturnValue(mockStatuses);
    const result = service.getEndpointStatuses();
    expect(result).toEqual(mockStatuses);
    expect(horizonClientService.getEndpointStatuses).toHaveBeenCalledTimes(1);
  });

  it('should delegate getHorizonRoot to horizonClientService', async () => {
    const mockRoot = { horizon_version: '2.0.0' } as any;
    mockHorizonClientService.getRoot.mockResolvedValue(mockRoot);
    const result = await service.getHorizonRoot();
    expect(result).toEqual(mockRoot);
    expect(horizonClientService.getRoot).toHaveBeenCalledTimes(1);
  });

  it('should delegate submitTransaction to horizonClientService', async () => {
    const mockTx = {} as any;
    const mockRes = { hash: '123' };
    mockHorizonClientService.submitTransaction.mockResolvedValue(mockRes);
    const result = await service.submitTransaction(mockTx);
    expect(result).toEqual(mockRes);
    expect(horizonClientService.submitTransaction).toHaveBeenCalledWith(mockTx);
  });

  it('should delegate getTransaction to horizonClientService', async () => {
    const mockRes = { hash: '123' };
    mockHorizonClientService.getTransaction.mockResolvedValue(mockRes);
    const result = await service.getTransaction('123');
    expect(result).toEqual(mockRes);
    expect(horizonClientService.getTransaction).toHaveBeenCalledWith('123');
  });
});
