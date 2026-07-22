import { StrKey } from 'stellar-sdk';

export function parseAdminWallets(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim() === '') return [];

  const wallets = value
    .split(',')
    .map((wallet) => wallet.trim())
    .filter((wallet) => wallet.length > 0);

  const invalidWallet = wallets.find((wallet) => !StrKey.isValidEd25519PublicKey(wallet));
  if (invalidWallet) {
    throw new Error(`ADMIN_WALLETS contains an invalid Stellar public key: ${invalidWallet}`);
  }

  return [...new Set(wallets)];
}

export function validateEnvironment(config: Record<string, unknown>): Record<string, unknown> {
  return {
    ...config,
    ADMIN_WALLETS: parseAdminWallets(config.ADMIN_WALLETS).join(','),
  };
}
