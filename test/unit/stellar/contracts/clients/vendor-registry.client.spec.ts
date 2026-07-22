jest.unmock('stellar-sdk');

import { ConfigService } from '@nestjs/config';
import * as StellarSdk from 'stellar-sdk';
import { SorobanService } from '../../../../../src/blockchain/soroban/soroban.service';
import { VendorRegistryContractClient } from '../../../../../src/stellar/contracts/clients/vendor-registry.client';
import { VENDOR_REGISTRY_CONTRACT_ID_KEY } from '../../../../../src/stellar/contracts/interfaces/vendor-registry.interface';

describe('VendorRegistryContractClient', () => {
  const contractId = StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 1));
  const admin = StellarSdk.Keypair.random().publicKey();
  const vendor = StellarSdk.Keypair.random().publicKey();
  const sourceAccount = new StellarSdk.Account(admin, '1');
  const prepareTransaction = jest.fn(async (transaction: StellarSdk.Transaction) => transaction);
  const simulateContractCall = jest.fn();
  const sorobanService = {
    getServer: () => ({
      getAccount: jest.fn(async () => sourceAccount),
      prepareTransaction,
    }),
    getNetworkPassphrase: () => StellarSdk.Networks.TESTNET,
    simulateContractCall,
  };
  const configService = {
    get: (key: string) => key === VENDOR_REGISTRY_CONTRACT_ID_KEY ? contractId : undefined,
  };
  const client = new VendorRegistryContractClient(
    sorobanService as unknown as SorobanService,
    configService as unknown as ConfigService,
  );

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['buildApproveVendorXdr', 'approve_vendor'],
    ['buildSuspendVendorXdr', 'suspend_vendor'],
  ] as const)('builds unsigned XDR for %s', async (clientMethod, contractMethod) => {
    const xdr = await client[clientMethod](admin, vendor);
    const transaction = StellarSdk.TransactionBuilder.fromXDR(xdr, StellarSdk.Networks.TESTNET);
    const operation = transaction.operations[0];

    expect(transaction.source).toBe(admin);
    expect(operation.type).toBe('invokeHostFunction');
    if (operation.type !== 'invokeHostFunction') throw new Error('Expected contract invocation');

    const invocation = operation.func.value() as unknown as {
      functionName(): { toString(): string };
    };
    expect(invocation.functionName().toString()).toBe(contractMethod);
    expect(prepareTransaction).toHaveBeenCalledTimes(1);
  });

  it('uses the current is_active contract function for approved vendors', async () => {
    simulateContractCall.mockResolvedValue(StellarSdk.nativeToScVal(true));

    await expect(client.isVendorActive(vendor)).resolves.toBe(true);
    expect(simulateContractCall).toHaveBeenCalledWith(
      contractId,
      'is_active',
      [expect.any(StellarSdk.xdr.ScVal)],
    );
  });
});
