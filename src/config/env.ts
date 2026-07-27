import { StrKey } from 'stellar-sdk';

/**
 * Parsed and validated list of admin wallet addresses.
 * Populated at module init from the ADMIN_WALLETS environment variable.
 *
 * An empty or unset value deliberately denies all admin access —
 * this turns a missing config into the most restrictive posture.
 */
let adminWallets: readonly string[] = [];

/**
 * Returns the frozen list of admin wallet addresses.
 */
export function getAdminWallets(): readonly string[] {
  return adminWallets;
}

/**
 * Parses the ADMIN_WALLETS environment variable, validates every entry
 * as a well-formed Stellar Ed25519 public key, and fails fast if any
 * entry is invalid.
 *
 * Must be called once during application bootstrap (AppModule.onModuleInit
 * or ConfigModule.forRoot lifecycle) before any guard reads the list.
 *
 * @throws {Error} immediately if any allowlist entry is not a valid
 *   Stellar public key — the message identifies the bad entry.
 */
export function validateAdminWallets(): void {
  const raw = process.env.ADMIN_WALLETS ?? '';
  const entries = raw
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0);

  for (const entry of entries) {
    if (!StrKey.isValidEd25519PublicKey(entry)) {
      throw new Error(
        `ADMIN_WALLETS contains an invalid Stellar address: "${entry}". ` +
          'Each entry must be a well-formed Stellar Ed25519 public key (starts with G, 56 characters).',
      );
    }
  }

  adminWallets = Object.freeze([...entries]);
}
