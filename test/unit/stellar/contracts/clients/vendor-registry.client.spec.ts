import { ConfigService } from '@nestjs/config';
import * as StellarSdk from 'stellar-sdk';
import { SorobanService } from '../../../../../src/blockchain/soroban/soroban.service';
import { ContractReadError } from '../../../../../src/stellar/contracts/errors';
import { VendorRegistryContractClient } from '../../../../../src/stellar/contracts/clients/vendor-registry.client';
import { VENDOR_REGISTRY_CONTRACT_ID_KEY } from '../../../../../src/stellar/contracts/interfaces/vendor-registry.interface';

describe('VendorRegistryContractClient', () => {
  const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
  const vendorAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
  const simulateContractCall = jest.fn();
  const sorobanService = { simulateContractCall } as unknown as SorobanService;
  const configService = {
    get: jest.fn((key: string) =>
      key === VENDOR_REGISTRY_CONTRACT_ID_KEY ? contractId : undefined,
    ),
  } as unknown as ConfigService;
  let client: VendorRegistryContractClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new VendorRegistryContractClient(sorobanService, configService);
  });

  it('calls is_active with a Stellar Address argument', async () => {
    simulateContractCall.mockResolvedValue(StellarSdk.nativeToScVal(true));

    await expect(client.isVendorActive(vendorAddress)).resolves.toBe(true);

    expect(simulateContractCall).toHaveBeenCalledWith(
      contractId,
      'is_active',
      [expect.anything()],
    );
    expect(StellarSdk.nativeToScVal).toHaveBeenCalledWith(vendorAddress, {
      type: 'address',
    });
  });

  it('calls get_vendor_info and maps an approved status', async () => {
    simulateContractCall.mockResolvedValue(
      StellarSdk.nativeToScVal({
        name: 'Course Vendor',
        registration_date: 1n,
        status: ['Approved'],
        total_sales: 0n,
      }),
    );

    await expect(client.getVendor(vendorAddress)).resolves.toEqual({
      id: vendorAddress,
      name: 'Course Vendor',
      status: 'Approved',
    });
    expect(simulateContractCall).toHaveBeenCalledWith(
      contractId,
      'get_vendor_info',
      [expect.anything()],
    );
    expect(StellarSdk.nativeToScVal).toHaveBeenCalledWith(vendorAddress, {
      type: 'address',
    });
  });

  it('rejects an unknown contract status', async () => {
    simulateContractCall.mockResolvedValue(
      StellarSdk.nativeToScVal({ name: 'Vendor', status: ['Unknown'] }),
    );

    await expect(client.getVendor(vendorAddress)).rejects.toBeInstanceOf(
      ContractReadError,
    );
  });

  it('returns null only for the vendor-not-found contract error', async () => {
    simulateContractCall.mockRejectedValue(
      new Error('HostError: Error(Contract, #4)'),
    );

    await expect(client.getVendor(vendorAddress)).resolves.toBeNull();
  });

  it('rethrows other host errors as a contract read error', async () => {
    simulateContractCall.mockRejectedValue(
      new Error('HostError: Error(Contract, #2)'),
    );

    await expect(client.getVendor(vendorAddress)).rejects.toBeInstanceOf(
      ContractReadError,
    );
  });
});
