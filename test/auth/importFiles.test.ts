import { describe, expect, test } from 'vitest';
import { createEncryptedBackupFile } from '../../src/domain/portable';
import { MAX_IMPORT_FILES, readImportFiles } from '../../src/domain/files';
import {parseTransfer} from '../../src/domain/transfer';
import {toAccount} from '../../src/domain/view';
import {accountDraft as createAccount} from '../../src/domain/view';
import type { AppSettings } from '../../src/domain/view';
import { DEFAULT_SETTINGS } from '../../src/domain/view';

const ALICE_URI = 'otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example';
const PASSWORD = 'correct horse battery staple';
const settings: AppSettings = { ...DEFAULT_SETTINGS };

describe('readImportFiles', () => {
  test.each([false, true])('keeps JSON and URI imports valid in either file order (reversed: %s)', async (reverse) => {
    const account = await createAccount({ label: 'Bob', secret: 'JBSWY3DPEHPK3PXP', type: 'hotp', counter: 42 });
    const files = [
      textFile('codes.txt', ALICE_URI),
      textFile('empty.txt', '   '),
      textFile('vault.json', JSON.stringify({ accounts: [account] }, null, 2)),
      textFile('empty-vault.json', '{"accounts":[]}')
    ];
    const selection = await readImportFiles(reverse ? files.reverse() : files);
    const accounts = (await Promise.all(selection.texts.map(parseTransfer))).flat().map(toAccount);

    expect(accounts).toHaveLength(2);
    expect(accounts).toContainEqual(expect.objectContaining({label:account.label,secret:account.secret,counter:42}));
    expect(accounts.some(({ label }) => label === 'alice@example.com')).toBe(true);
    expect(selection.encrypted).toEqual([]);
    expect(selection.errors).toEqual([]);
  });

  test('holds encrypted backups back until a password is known', async () => {
    const backup = await createEncryptedBackupFile([], settings, PASSWORD);
    const selection = await readImportFiles([
      new File([await backup.blob.text()], 'backup.json', { type: 'application/json' }),
      textFile('codes.txt', ALICE_URI)
    ]);

    expect(selection.texts).toEqual([ALICE_URI]);
    expect(selection.encrypted).toHaveLength(1);
    expect(selection.encrypted[0].name).toBe('backup.json');
    expect(selection.encrypted[0].text).toContain('authenticator.portable');
  });

  test('reports oversized files without dropping the readable ones', async () => {
    const selection = await readImportFiles([
      new File([new Uint8Array(3 * 1024 * 1024)], 'huge.txt', { type: 'text/plain' }),
      textFile('codes.txt', ALICE_URI)
    ]);

    expect(selection.texts).toEqual([ALICE_URI]);
    expect(selection.errors).toEqual(['huge.txt: File is too large to import.']);
  });

  test('reports unreadable QR images without dropping text files', async () => {
    const selection = await readImportFiles([
      textFile('codes.txt', ALICE_URI),
      new File([new Uint8Array(8)], 'screenshot.png', { type: 'image/png' })
    ]);

    expect(selection.texts).toEqual([ALICE_URI]);
    expect(selection.errors).toHaveLength(1);
    expect(selection.encrypted).toEqual([]);
  });

  test('rejects oversized selections before reading anything', async () => {
    const files = Array.from({ length: MAX_IMPORT_FILES + 1 }, (_, index) =>
      textFile(`codes-${index}.txt`, ALICE_URI)
    );

    await expect(readImportFiles(files)).rejects.toThrow(
      `Select ${MAX_IMPORT_FILES} or fewer files at a time.`
    );
  });
});

function textFile(name: string, contents: string): File {
  return new File([contents], name, { type: 'text/plain' });
}
