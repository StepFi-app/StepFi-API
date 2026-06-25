/**
 * Grace period (in days) before an overdue loan is considered defaulted.
 *
 * A loan whose `next_payment_due` is more than this many days past will be
 * flagged as defaulted by both the automated job and the manual endpoint.
 */
export const DEFAULT_GRACE_PERIOD_DAYS = 30;
