import { expect, test } from 'vitest';
import {
  getSyncErrorKey,
  getSyncStatusKey
} from '../../src/features/sync/status';

test.each([
  ['off', 'syncReady'],
  ['ready', 'syncReady'],
  ['syncing', 'syncSyncing'],
  ['pending', 'syncPending'],
  ['error', 'syncErrorStatus']
] as const)('%s selects the corresponding status message', (status, key) => {
  expect(getSyncStatusKey(status)).toBe(key);
});

test.each([
  ['invalidData', 'syncInvalidData'],
  ['invalidKey', 'syncWrongKey'],
  ['notFound', 'syncNoData'],
  ['passwordRequired', 'syncProtectionRequired'],
  ['quota', 'syncQuota'],
  ['unavailable', 'syncUnavailable'],
  ['storage', 'syncFailed'],
  ['unexpected', 'syncFailed'],
  ['constructor', 'syncFailed']
] as const)(
  '%s selects a localized sync failure without exposing raw errors',
  (reason, key) => {
    expect(getSyncErrorKey(reason)).toBe(key);
  }
);
