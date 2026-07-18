import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CreditLineContractClient } from '../../../../../src/stellar/contracts/clients/creditline.client';
import { SorobanService } from '../../../../../src/blockchain/soroban/soroban.service';
import { CREDIT_LINE_CONTRACT_ID_KEY } from '../../../../../src/stellar/contracts/interfaces/creditline.interface';

describe('CreditLineContractClient', () => {
  let client: CreditLineContractClient;

  const mockSorobanService = {
    getServer: jest.fn(),
    getNetworkPassphrase: jest.fn().mockReturnValue('Test SDF Network ; September 2015'),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === CREDIT_LINE_CONTRACT_ID_KEY || key === 'CREDITLINE_CONTRACT_ID') {
        return 'CDLZFC3SYJYDZT7K3VJ4STDQ2G6FJFY5ODV2S4W3C5KQ5Y2V3K4X5Y6Z';
      }
      return undefined;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreditLineContractClient,
        { provide: SorobanService, useValue: mockSorobanService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    client = module.get<CreditLineContractClient>(CreditLineContractClient);
  });

  describe('toContractAmount', () => {
    it('converts $1,000.00 to 10,000,000,000 stroops', () => {
      const result = (client as any).toContractAmount(1000);
      expect(result).toBe(10_000_000_000n);
    });

    it('converts $0.00 to 0 stroops', () => {
      const result = (client as any).toContractAmount(0);
      expect(result).toBe(0n);
    });

    it('converts $1.00 to 10,000,000 stroops', () => {
      const result = (client as any).toContractAmount(1);
      expect(result).toBe(10_000_000n);
    });

    it('converts $0.50 to 5,000,000 stroops', () => {
      const result = (client as any).toContractAmount(0.5);
      expect(result).toBe(5_000_000n);
    });

    it('converts $0.01 to 100,000 stroops', () => {
      const result = (client as any).toContractAmount(0.01);
      expect(result).toBe(100_000n);
    });

    it('rounds to nearest stroop', () => {
      const result = (client as any).toContractAmount(0.12345678);
      expect(result).toBe(1_234_568n);
    });
  });
});
