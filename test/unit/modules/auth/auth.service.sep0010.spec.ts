// A manual mock at test/__mocks__/stellar-sdk.js is auto-applied to every test
// file (jest auto-mocks node modules that have a manual mock under roots). This
// spec needs the REAL SDK to exercise the genuine sign/verify round-trip, so we
// opt out explicitly. jest.unmock is hoisted above the imports by ts-jest.
jest.unmock('stellar-sdk');

import { InternalServerErrorException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Account, BASE_FEE, Keypair, Operation, Transaction, TransactionBuilder } from 'stellar-sdk';
import { AuthService } from '../../../../src/modules/auth/auth.service';
import { SupabaseService } from '../../../../src/database/supabase.client';
import { UsersRepository } from '../../../../src/database/repositories/users.repository';
import { AuditService } from '../../../../src/modules/admin/audit.service';
import { VerifyRequestDto } from '../../../../src/modules/auth/dto/verify-request.dto';

// This spec intentionally does NOT mock stellar-sdk. jest.mock is per-file, so
// the message-scheme spec (auth.service.spec.ts) can keep its lightweight mock
// while this file exercises the real SEP-10 challenge round-trip: build an
// unsigned challenge transaction on the server, sign it with a throwaway
// Keypair (exactly what a signXDR-only wallet like mobile Lobstr does), and
// prove POST /auth/verify accepts it and rejects every tamper.

const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const CHALLENGE_DATA_NAME = 'stepfi_auth_challenge';

describe('AuthService — SEP-10 challenge transaction (sep0010)', () => {
  const wallet = Keypair.random();
  const walletAddress = wallet.publicKey();

  // Captures the row generateNonce inserts, so the verify SELECT can return the
  // exact message_hash the challenge was bound to.
  let insertedNonce: { nonce: string; expires_at: string; issued_at: string; message_hash: string } | null;
  const mockInsert = jest.fn((row: typeof insertedNonce) => {
    insertedNonce = row;
    return Promise.resolve({ error: null });
  });

  // Overridable results for the verify-path nonces builder.
  let nonceSelectResult: { data: unknown; error: unknown };
  let claimResult: { data: unknown[] | null; error: unknown; count: number | null };

  const mockFrom = jest.fn((table: string) => {
    if (table !== 'nonces') {
      return { insert: jest.fn().mockResolvedValue({ error: null }) };
    }
    const builder: Record<string, jest.Mock> = {
      insert: mockInsert as unknown as jest.Mock,
      select: jest.fn(),
      eq: jest.fn(),
      is: jest.fn(),
      single: jest.fn().mockImplementation(() => Promise.resolve(nonceSelectResult)),
      update: jest.fn(),
    };
    let operation: 'select' | 'update' = 'select';
    builder.select.mockImplementation(() => {
      if (operation === 'update') return Promise.resolve(claimResult);
      return builder;
    });
    builder.update.mockImplementation(() => {
      operation = 'update';
      return builder;
    });
    builder.eq.mockReturnValue(builder);
    builder.is.mockReturnValue(builder);
    return builder;
  });

  const mockSupabaseService = {
    getServiceRoleClient: jest.fn(() => ({ from: mockFrom })),
  };

  function createService(): AuthService {
    const config = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'API_URL':
            return 'http://localhost:3000';
          case 'API_PREFIX':
            return 'api/v1';
          case 'STELLAR_NETWORK_PASSPHRASE':
            return NETWORK_PASSPHRASE;
          default:
            return undefined;
        }
      }),
    };
    return new AuthService(
      mockSupabaseService as unknown as SupabaseService,
      { sign: jest.fn().mockReturnValue('mock.jwt.token'), verify: jest.fn() } as unknown as JwtService,
      config as unknown as ConfigService,
      {} as unknown as UsersRepository,
      { log: jest.fn(), logWithBeforeAfter: jest.fn() } as unknown as AuditService,
    );
  }

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    insertedNonce = null;
    claimResult = { data: [{ id: 'nonce-uuid' }], error: null, count: 1 };
    service = createService();
  });

  /** Issues a real challenge via generateNonce and wires the verify SELECT to it. */
  async function issueChallenge(): Promise<{ nonce: string; challengeXdr: string }> {
    const result = await service.generateNonce(walletAddress);
    // The verify SELECT must observe the same row generateNonce persisted.
    nonceSelectResult = {
      data: {
        id: 'nonce-uuid',
        expires_at: insertedNonce!.expires_at,
        issued_at: insertedNonce!.issued_at,
        message_hash: insertedNonce!.message_hash,
      },
      error: null,
    };
    return { nonce: result.nonce, challengeXdr: result.challengeXdr };
  }

  function signXdr(xdr: string, signer: Keypair = wallet): string {
    const tx = new Transaction(xdr, NETWORK_PASSPHRASE);
    tx.sign(signer);
    return tx.toXDR();
  }

  /** Builds a custom (tampered) challenge transaction bound to the given hash. */
  function buildTx(opts: {
    source?: string;
    accountSeq?: string;
    dataName?: string;
    dataValue: Buffer;
    minTime: number;
    maxTime: number;
  }): Transaction {
    const account = new Account(opts.source ?? walletAddress, opts.accountSeq ?? '-1');
    return new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
      timebounds: { minTime: opts.minTime, maxTime: opts.maxTime },
    })
      .addOperation(Operation.manageData({ name: opts.dataName ?? CHALLENGE_DATA_NAME, value: opts.dataValue }))
      .build();
  }

  function verifyDto(signedXdr: string, nonce: string): VerifyRequestDto {
    return { wallet: walletAddress, nonce, signatureType: 'sep0010', signedXdr };
  }

  it('generateNonce returns a challengeXdr whose manageData value equals the stored hash', async () => {
    const { challengeXdr } = await issueChallenge();
    const tx = new Transaction(challengeXdr, NETWORK_PASSPHRASE);

    expect(tx.source).toBe(walletAddress);
    expect(tx.sequence).toBe('0');
    expect(tx.operations).toHaveLength(1);
    const op = tx.operations[0] as { type: string; name: string; value: Buffer };
    expect(op.type).toBe('manageData');
    expect(op.name).toBe(CHALLENGE_DATA_NAME);
    expect(Buffer.from(op.value).toString('hex')).toBe(insertedNonce!.message_hash);
  });

  it('accepts a correctly signed challenge transaction', async () => {
    const { nonce, challengeXdr } = await issueChallenge();
    const signedXdr = signXdr(challengeXdr);

    await expect(service.verifySignature(verifyDto(signedXdr, nonce))).resolves.toBeUndefined();
  });

  it('rejects a challenge with no wallet signature (AUTH_SIGNATURE_INVALID)', async () => {
    const { nonce, challengeXdr } = await issueChallenge();

    // Submit the unsigned challenge as-is.
    await expect(service.verifySignature(verifyDto(challengeXdr, nonce))).rejects.toMatchObject({
      response: { code: 'AUTH_SIGNATURE_INVALID' },
    });
  });

  it('rejects a signature from a different keypair (AUTH_SIGNATURE_INVALID)', async () => {
    const { nonce, challengeXdr } = await issueChallenge();
    const signedXdr = signXdr(challengeXdr, Keypair.random());

    await expect(service.verifySignature(verifyDto(signedXdr, nonce))).rejects.toMatchObject({
      response: { code: 'AUTH_SIGNATURE_INVALID' },
    });
  });

  it('rejects a tampered manageData value (AUTH_CHALLENGE_MISMATCH)', async () => {
    const { nonce } = await issueChallenge();
    const now = Math.floor(Date.now() / 1000);
    const tampered = buildTx({
      dataValue: Buffer.alloc(32, 1), // wrong 32 bytes
      minTime: now - 60,
      maxTime: now + 300,
    });
    tampered.sign(wallet);

    await expect(service.verifySignature(verifyDto(tampered.toXDR(), nonce))).rejects.toMatchObject({
      response: { code: 'AUTH_CHALLENGE_MISMATCH' },
    });
  });

  it('rejects a wrong source account (AUTH_CHALLENGE_MISMATCH)', async () => {
    const { nonce } = await issueChallenge();
    const other = Keypair.random();
    const now = Math.floor(Date.now() / 1000);
    const wrongSource = buildTx({
      source: other.publicKey(),
      dataValue: Buffer.from(insertedNonce!.message_hash, 'hex'),
      minTime: now - 60,
      maxTime: now + 300,
    });
    wrongSource.sign(other);

    await expect(service.verifySignature(verifyDto(wrongSource.toXDR(), nonce))).rejects.toMatchObject({
      response: { code: 'AUTH_CHALLENGE_MISMATCH' },
    });
  });

  it('rejects a wrong manageData name (AUTH_CHALLENGE_MISMATCH)', async () => {
    const { nonce } = await issueChallenge();
    const now = Math.floor(Date.now() / 1000);
    const wrongName = buildTx({
      dataName: 'not_stepfi_auth',
      dataValue: Buffer.from(insertedNonce!.message_hash, 'hex'),
      minTime: now - 60,
      maxTime: now + 300,
    });
    wrongName.sign(wallet);

    await expect(service.verifySignature(verifyDto(wrongName.toXDR(), nonce))).rejects.toMatchObject({
      response: { code: 'AUTH_CHALLENGE_MISMATCH' },
    });
  });

  it('rejects an expired challenge transaction (AUTH_NONCE_EXPIRED)', async () => {
    const { nonce } = await issueChallenge();
    const now = Math.floor(Date.now() / 1000);
    const expired = buildTx({
      dataValue: Buffer.from(insertedNonce!.message_hash, 'hex'),
      minTime: now - 600,
      maxTime: now - 300, // already past
    });
    expired.sign(wallet);

    await expect(service.verifySignature(verifyDto(expired.toXDR(), nonce))).rejects.toMatchObject({
      response: { code: 'AUTH_NONCE_EXPIRED' },
    });
  });

  it('rejects malformed signedXdr (AUTH_SIGNATURE_INVALID)', async () => {
    const { nonce } = await issueChallenge();

    await expect(service.verifySignature(verifyDto('not-a-valid-xdr', nonce))).rejects.toMatchObject({
      response: { code: 'AUTH_SIGNATURE_INVALID' },
    });
  });

  it('rejects when signedXdr is missing (AUTH_SIGNATURE_INVALID)', async () => {
    const { nonce } = await issueChallenge();

    await expect(
      service.verifySignature({ wallet: walletAddress, nonce, signatureType: 'sep0010' }),
    ).rejects.toMatchObject({ response: { code: 'AUTH_SIGNATURE_INVALID' } });
  });

  it('burns the nonce before verification — a consumed nonce is rejected', async () => {
    const { nonce, challengeXdr } = await issueChallenge();
    claimResult = { data: [], error: null, count: 0 }; // claim races/loses
    const signedXdr = signXdr(challengeXdr);

    await expect(service.verifySignature(verifyDto(signedXdr, nonce))).rejects.toMatchObject({
      response: { code: 'AUTH_NONCE_NOT_FOUND' },
    });
  });

  it('surfaces a nonce insert failure from generateNonce', async () => {
    mockInsert.mockResolvedValueOnce({ error: { message: 'boom' } });
    await expect(service.generateNonce(walletAddress)).rejects.toThrow(InternalServerErrorException);
  });
});
