jest.unmock('stellar-sdk');

import { Keypair } from 'stellar-sdk';
import { parseAdminWallets, validateEnvironment } from '../../../src/config/env';

describe('environment validation', () => {
  it('normalizes and de-duplicates valid admin wallets', () => {
    const first = Keypair.random().publicKey();
    const second = Keypair.random().publicKey();

    expect(parseAdminWallets(` ${first},${second},${first} `)).toEqual([first, second]);
  });

  it('treats an empty or missing allowlist as deny-all configuration', () => {
    expect(parseAdminWallets(undefined)).toEqual([]);
    expect(validateEnvironment({ ADMIN_WALLETS: '  ' }).ADMIN_WALLETS).toBe('');
  });

  it('fails startup validation for an invalid Stellar public key', () => {
    expect(() => validateEnvironment({ ADMIN_WALLETS: 'not-a-stellar-wallet' })).toThrow(
      'ADMIN_WALLETS contains an invalid Stellar public key',
    );
  });
});
