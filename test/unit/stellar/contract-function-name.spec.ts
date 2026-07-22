jest.unmock('stellar-sdk');

import * as StellarSdk from 'stellar-sdk';
import { CreditLineContractClient } from '../../../src/stellar/contracts/clients/creditline.client';
import { SorobanService } from '../../../src/blockchain/soroban/soroban.service';
import { ConfigService } from '@nestjs/config';

describe('Repayment function name alignment', () => {
  let client: CreditLineContractClient;
  let mockServer: { prepareTransaction: jest.Mock; getAccount: jest.Mock };

  const testContractId = 'CC4C3VI4FS6J5PP7OQN4ZC3WWBYMAISPRN4VYTCZ2J7CHI3255OM32LT';
  const testNetwork = 'Test SDF Network ; September 2015';
  const testWallet = 'GAZBSUBUXTD6YVYXECZRW2R6K7MOU5FGU2SVYXKYWOLT5H3JIRD54EZL';

  beforeEach(() => {
    mockServer = {
      prepareTransaction: jest.fn(async (tx: StellarSdk.Transaction) => {
        return { toXDR: () => tx.toXDR() };
      }),
      getAccount: jest.fn().mockResolvedValue({}),
    };

    const mockSorobanService = {
      getServer: jest.fn().mockReturnValue(mockServer),
      getNetworkPassphrase: jest.fn().mockReturnValue(testNetwork),
    };

    const mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'CREDIT_LINE_CONTRACT_ID' || key === 'CREDITLINE_CONTRACT_ID') {
          return testContractId;
        }
        return undefined;
      }),
    };

    client = new CreditLineContractClient(
      mockSorobanService as unknown as SorobanService,
      mockConfigService as unknown as ConfigService,
    );
  });

  it('XDR builder and transaction checker use the same function name: repay_installment with 3 args', async () => {
    const xdr = await client.buildRepayInstallmentTx(testWallet, 'test-loan-123', 100);

    const tx = StellarSdk.TransactionBuilder.fromXDR(xdr, testNetwork);
    const innerTx =
      tx instanceof StellarSdk.FeeBumpTransaction ? tx.innerTransaction : tx;
    const op = innerTx.operations[0];

    expect(op.type).toBe('invokeHostFunction');

    const invocation = ((op as unknown as { func: unknown }).func as {
      _value?: { _attributes?: { functionName?: { toString?: () => string }; args?: unknown[] } };
    })?._value?._attributes;

    expect(invocation).toBeDefined();

    const functionName = invocation!.functionName?.toString?.();
    expect(functionName).toBe('repay_installment');

    const args = invocation!.args as unknown[];
    expect(args).toHaveLength(3);
  });
});
