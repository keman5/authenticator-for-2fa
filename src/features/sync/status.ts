import type { MessageKey } from '../../lib/i18n/messages';

const labels = {
  error: 'syncErrorStatus',
  off: 'syncReady',
  pending: 'syncPending',
  ready: 'syncReady',
  syncing: 'syncSyncing'
} as const satisfies Record<string, MessageKey>;

export type SyncStatus = keyof typeof labels;

export const getSyncStatusKey = (state: SyncStatus): MessageKey =>
  labels[state];

const failures = new Map<string, MessageKey>([
  ['invalidData', 'syncInvalidData'],
  ['invalidKey', 'syncWrongKey'],
  ['notFound', 'syncNoData'],
  ['passwordRequired', 'syncProtectionRequired'],
  ['quota', 'syncQuota'],
  ['unavailable', 'syncUnavailable']
]);

export const getSyncErrorKey = (reason: string): MessageKey =>
  failures.get(reason) ?? 'syncFailed';
