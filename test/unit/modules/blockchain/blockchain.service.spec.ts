import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as StellarSdk from 'stellar-sdk';
import { BlockchainService } from '../../../../src/modules/blockchain/blockchain.service';
import {
  SequenceManagerService,
} from '../../../../src/blockchain/sequence-manager/sequence-manager.service';

// ──────────────────────────── focused wrapping tests ────────────────────────────
//
// These cases live here (not in sequence-manager.service.spec.ts) because
// the surface they exercise belongs to BlockchainService, not the
// allocator: how raw Horizon / manager errors become Nest exceptions.
//
// The user-signed handleHorizonError path is covered by
// transactions.service.spec.ts — its tx_bad_seq / tx_bad_auth etc.
// rejection path is unchanged by #82 because the dedicated
// STELLAR_TX_BAD_SEQ branch was reverted in handleHorizonError.

function buildConfigService(): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'STELLAR_HORIZON_URL') return 'https://horizon-testnet.stellar.org';
      if (key === 'STELLAR_NETWORK_PASSPHRASE') return StellarSdk.Networks.TESTNET;
      return undefined;
    },
  } as unknown as ConfigService;
}

function fakeManager(
  impl: jest.Mock = jest.fn(),
): SequenceManagerService {
  return {
    isEnabled: () => true,
    getAccountCount: () => 1,
    getManagedAccounts: () => ['G'.padEnd(56, 'A')],
    submitServerTransaction: impl,
  } as unknown as SequenceManagerService;
}

function buildNoopTx(): StellarSdk.Transaction {
  return new StellarSdk.TransactionBuilder(
    new StellarSdk.Account('G'.padEnd(56, 'A'), '101'),
    { fee: '100', networkPassphrase: StellarSdk.Networks.TESTNET },
  )
    .setTimeout(30)
    .build();
}

afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe('BlockchainService.submitServerTransaction error wrapping', () => {
  it('returns the hash on successful manager result', async () => {
    const manager = fakeManager(
      jest.fn().mockResolvedValue({
        hash: 'h1',
        sourceAccount: 'G'.padEnd(56, 'A'),
        sequence: '101',
      }),
    );
    const service = new BlockchainService(buildConfigService(), manager);
    await expect(
      service.submitServerTransaction({ build: buildNoopTx }),
    ).resolves.toEqual({
      transactionHash: 'h1',
      sourceAccount: 'G'.padEnd(56, 'A'),
      sequence: '101',
    });
  });

  it('throws BadRequestException with STELLAR_OP_UNDERFUNDED for known Horizon codes', async () => {
    const manager = fakeManager(
      jest.fn().mockRejectedValue({
        response: {
          data: {
            extras: { result_codes: { transaction: 'op_underfunded', operations: [] } },
          },
        },
      }),
    );
    const service = new BlockchainService(buildConfigService(), manager);

    await expect(
      service.submitServerTransaction({ build: buildNoopTx }),
    ).rejects.toMatchObject({ response: { code: 'STELLAR_OP_UNDERFUNDED' } });
  });

  it('throws BadRequestException with STELLAR_TX_BAD_SEQ when the manager observes tx_bad_seq', async () => {
    // The server path uses handleServerSubmissionError; if the manager
    // re-throws a Horizon tx_bad_seq (e.g. after the retry budget was
    // exhausted), the wrapper maps it to STELLAR_TX_BAD_SEQ.
    const manager = fakeManager(
      jest.fn().mockRejectedValue({
        response: {
          data: { extras: { result_codes: { transaction: 'tx_bad_seq' } } },
        },
      }),
    );
    const service = new BlockchainService(buildConfigService(), manager);

    await expect(
      service.submitServerTransaction({ build: buildNoopTx }),
    ).rejects.toMatchObject({ response: { code: 'STELLAR_TX_BAD_SEQ' } });
  });

  it('throws InternalServerErrorException for SequenceManager-prefixed errors', async () => {
    const manager = fakeManager(
      jest.fn().mockRejectedValue(
        new Error('SequenceManager: source account unfunded'),
      ),
    );
    const service = new BlockchainService(buildConfigService(), manager);

    await expect(
      service.submitServerTransaction({ build: buildNoopTx }),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('throws ServiceUnavailableException for transient network errors', async () => {
    const manager = fakeManager(
      jest.fn().mockRejectedValue(
        new Error('connection timeout while contacting Horizon'),
      ),
    );
    const service = new BlockchainService(buildConfigService(), manager);

    await expect(
      service.submitServerTransaction({ build: buildNoopTx }),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
