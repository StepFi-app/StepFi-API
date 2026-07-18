import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from 'stellar-sdk';
import { HorizonClientService } from '../../../src/stellar/horizon-client.service';

jest.mock('stellar-sdk');

describe('HorizonClientService', () => {
  let mockFetch: jest.Mock;
  let originalFetch: typeof global.fetch;

  const mockHorizonServerInstance = {
    submitTransaction: jest.fn(),
    transactions: jest.fn(),
  };

  const mockConfig = {
    get: jest.fn(),
  };

  beforeAll(() => {
    originalFetch = global.fetch;
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    mockConfig.get.mockReset();
    mockFetch.mockReset();
    jest.clearAllMocks();
    (StellarSdk.Horizon.Server as jest.Mock).mockReturnValue(mockHorizonServerInstance);
  });

  async function createService(mockConfigImpl?: (key: string) => any): Promise<HorizonClientService> {
    if (mockConfigImpl) {
      mockConfig.get.mockImplementation(mockConfigImpl);
    }
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HorizonClientService,
        {
          provide: ConfigService,
          useValue: mockConfig,
        },
      ],
    }).compile();

    const svc = module.get<HorizonClientService>(HorizonClientService);
    svc.onModuleInit();
    return svc;
  }

  describe('Initialization and Configuration', () => {
    it('should fall back to default endpoint if no config is provided', async () => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'STELLAR_NETWORK_PASSPHRASE') return 'Test SDF Network ; September 2015';
        return undefined;
      });

      const tempService = await createService();
      const statuses = tempService.getEndpointStatuses();
      expect(statuses.length).toBe(1);
      expect(statuses[0].url).toBe('https://horizon-testnet.stellar.org');
      expect(statuses[0].isPrimary).toBe(true);
    });

    it('should parse multiple endpoints from STELLAR_HORIZON_URLS', async () => {
      const tempService = await createService((key: string) => {
        if (key === 'STELLAR_HORIZON_URLS') {
          return 'https://endpoint1.org, https://endpoint2.org ';
        }
        return undefined;
      });

      const statuses = tempService.getEndpointStatuses();
      expect(statuses.length).toBe(2);
      expect(statuses[0].url).toBe('https://endpoint1.org');
      expect(statuses[0].isPrimary).toBe(true);
      expect(statuses[1].url).toBe('https://endpoint2.org');
      expect(statuses[1].isPrimary).toBe(false);
    });
  });

  describe('withFailover Operations', () => {
    it('should execute successfully on primary endpoint', async () => {
      const service = await createService((key: string) => {
        if (key === 'STELLAR_HORIZON_URLS') {
          return 'https://primary.org, https://backup.org';
        }
        return undefined;
      });

      const rootResponse = {
        horizon_version: '2.0.0',
        network: 'testnet',
        core_version: 'v22.0.0',
        history_latest_ledger: 12345,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(rootResponse),
      });

      const result = await service.getRoot();

      expect(result).toEqual(rootResponse);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith('https://primary.org');

      const statuses = service.getEndpointStatuses();
      expect(statuses[0].isPrimary).toBe(true);
      expect(statuses[0].status).toBe('closed');
    });

    it('should failover to secondary if primary fails with network error', async () => {
      const service = await createService((key: string) => {
        if (key === 'STELLAR_HORIZON_URLS') {
          return 'https://primary.org, https://backup.org';
        }
        return undefined;
      });

      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      const rootResponse = {
        horizon_version: '2.0.0',
        network: 'testnet',
        core_version: 'v22.0.0',
        history_latest_ledger: 12345,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(rootResponse),
      });

      const result = await service.getRoot();

      expect(result).toEqual(rootResponse);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0]).toBe('https://primary.org');
      expect(mockFetch.mock.calls[1][0]).toBe('https://backup.org');

      const statuses = service.getEndpointStatuses();
      expect(statuses[0].isPrimary).toBe(false);
      expect(statuses[0].failureCount).toBe(1);
      expect(statuses[1].isPrimary).toBe(true);
      expect(statuses[1].status).toBe('closed');
    });

    it('should open circuit breaker for primary after 3 consecutive failures', async () => {
      const singleService = await createService((key: string) => {
        if (key === 'STELLAR_HORIZON_URLS') {
          return 'https://primary.org';
        }
        return undefined;
      });

      // Trigger 3 failures on primary
      for (let i = 0; i < 3; i++) {
        mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
        await expect(singleService.getRoot()).rejects.toThrow('All Horizon endpoints are unavailable');
      }

      const statuses = singleService.getEndpointStatuses();
      expect(statuses[0].status).toBe('open');
      expect(statuses[0].failureCount).toBe(3);
      expect(statuses[0].lastFailure).toBe('fetch failed');
    });

    it('should skip open endpoint and only request backup if cooldown is active', async () => {
      const service = await createService((key: string) => {
        if (key === 'STELLAR_HORIZON_URLS') {
          return 'https://primary.org, https://backup.org';
        }
        return undefined;
      });

      // 1. primary fails, backup succeeds. currentIndex -> 1 (backup). primary failCount = 1.
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
      mockFetch.mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue({}) });
      await service.getRoot();

      // 2. backup fails, primary fails. Both fail. primary failCount = 2, backup failCount = 1.
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
      await expect(service.getRoot()).rejects.toThrow('All Horizon endpoints are unavailable');

      // 3. backup fails, primary fails. Both fail. primary failCount = 3 (opens!), backup failCount = 2.
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
      await expect(service.getRoot()).rejects.toThrow('All Horizon endpoints are unavailable');

      // Cooldown fast forward so both can be checked
      const originalNow = Date.now;
      Date.now = () => originalNow() + 31000;

      // 4. backup fails (opens!), primary succeeds (closes!). currentIndex -> 0 (primary).
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
      mockFetch.mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue({}) });
      await service.getRoot();

      // Restore time: backup is now open with active cooldown. primary is closed.
      Date.now = originalNow;

      mockFetch.mockClear();
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      // 5. call getRoot. primary fails. backup should be skipped since it is open and cooldown is active.
      await expect(service.getRoot()).rejects.toThrow('All Horizon endpoints are unavailable');

      // Verify backup was skipped and not called
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith('https://primary.org');
    });

    it('should try primary as half-open when cooldown expires and reset on success', async () => {
      const singleService = await createService((key: string) => {
        if (key === 'STELLAR_HORIZON_URLS') {
          return 'https://primary.org';
        }
        return undefined;
      });

      // Open primary breaker
      for (let i = 0; i < 3; i++) {
        mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
        await expect(singleService.getRoot()).rejects.toThrow('All Horizon endpoints are unavailable');
      }

      // Fast forward cooldown time
      const originalNow = Date.now;
      Date.now = () => originalNow() + 31000; // > 30s cooldown

      mockFetch.mockClear();
      // Primary success now (half-open -> closed)
      mockFetch.mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue({ success: true }) });

      await singleService.getRoot();

      expect(mockFetch).toHaveBeenCalledWith('https://primary.org');
      const statuses = singleService.getEndpointStatuses();
      expect(statuses[0].status).toBe('closed');
      expect(statuses[0].failureCount).toBe(0);

      Date.now = originalNow; // restore
    });

    it('should throw error when all endpoints are failed', async () => {
      const service = await createService((key: string) => {
        if (key === 'STELLAR_HORIZON_URLS') {
          return 'https://primary.org, https://backup.org';
        }
        return undefined;
      });

      mockFetch.mockRejectedValue(new TypeError('fetch failed'));

      await expect(service.getRoot()).rejects.toThrow('All Horizon endpoints are unavailable');
    });
  });

  describe('submitTransaction & getTransaction wrappers', () => {
    let service: HorizonClientService;

    beforeEach(async () => {
      service = await createService();
    });

    it('should execute submitTransaction and wrap response', async () => {
      const mockResult = { hash: 'txhash123' };
      mockHorizonServerInstance.submitTransaction.mockResolvedValue(mockResult);

      const mockTx = {} as any;
      const result = await service.submitTransaction(mockTx);

      expect(result).toEqual(mockResult);
    });

    it('should execute getTransaction and wrap response', async () => {
      const mockResult = { hash: 'txhash123', ledger: 100 };
      const mockTransactionCall = {
        call: jest.fn().mockResolvedValue(mockResult),
      };
      const mockTransactionsBuilder = {
        transaction: jest.fn().mockReturnValue(mockTransactionCall),
      };
      mockHorizonServerInstance.transactions = jest.fn().mockReturnValue(mockTransactionsBuilder);

      const result = await service.getTransaction('txhash123');

      expect(result).toEqual(mockResult);
      expect(mockTransactionsBuilder.transaction).toHaveBeenCalledWith('txhash123');
    });
  });
});
