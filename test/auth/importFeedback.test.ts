import { expect, test } from 'vitest';
import { localizeQrError } from '../../src/features/import-export/importFeedback';
import { QR_DECODE_ERROR } from '../../src/domain/qr';
import { QR_IMAGE_TOO_LARGE_ERROR } from '../../src/domain/image';
import { LANGUAGES } from '../../src/lib/i18n/languages';
import { t } from '../../src/lib/i18n/messages';

test.each(LANGUAGES)('QR diagnostics use the selected $code language', ({ code }) => {
  const translate = (key: Parameters<typeof t>[1]) => t(code, key);
  for (const [message, key] of [
    [QR_DECODE_ERROR, 'qrNotFound'],
    ['No QR code was found near that click or in the selected area.', 'qrNotFound'],
    [QR_IMAGE_TOO_LARGE_ERROR, 'qrImageTooLarge'],
    ['Select 20 or fewer QR images at a time.', 'qrFileLimit'],
    ['Select 20 or fewer files at a time.', 'qrFileLimit'],
    ['Canvas rendering is unavailable.', 'qrUnavailable']
  ] as const) {
    expect(localizeQrError(message, translate)).toBe(t(code, key));
    if (code !== 'en') expect(localizeQrError(message, translate)).not.toBe(t('en', key));
  }
  expect(localizeQrError('Backup password is incorrect.', translate)).toBe('Backup password is incorrect.');
});
