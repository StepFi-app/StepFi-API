export const JOB_STALE_THRESHOLD_CONFIG = {
  indexer: {
    env: 'JOB_STALE_THRESHOLD_INDEXER_SECONDS',
    defaultSeconds: 180,
  },
  transactionStatusChecker: {
    env: 'JOB_STALE_THRESHOLD_TRANSACTION_STATUS_CHECKER_SECONDS',
    defaultSeconds: 360,
  },
  loanPaymentReminder: {
    env: 'JOB_STALE_THRESHOLD_LOAN_PAYMENT_REMINDER_SECONDS',
    defaultSeconds: 93_600,
  },
  nonceCleanup: {
    env: 'JOB_STALE_THRESHOLD_NONCE_CLEANUP_SECONDS',
    defaultSeconds: 7_200,
  },
  supabaseKeepAlive: {
    env: 'JOB_STALE_THRESHOLD_SUPABASE_KEEPALIVE_SECONDS',
    defaultSeconds: 345_600,
  },
} as const;

export type MonitoredJobName = keyof typeof JOB_STALE_THRESHOLD_CONFIG;

export function validateEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const validated = { ...config };

  for (const { env, defaultSeconds } of Object.values(
    JOB_STALE_THRESHOLD_CONFIG,
  )) {
    const rawValue = config[env];
    const parsed =
      rawValue === undefined || rawValue === ''
        ? defaultSeconds
        : Number(rawValue);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`${env} must be a positive integer number of seconds`);
    }

    validated[env] = parsed;
  }

  return validated;
}
