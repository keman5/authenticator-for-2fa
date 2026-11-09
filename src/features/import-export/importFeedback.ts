import type { ImportResult } from '../../domain/view';
import { QR_DECODE_ERROR } from '../../domain/qr';
import { QR_IMAGE_TOO_LARGE_ERROR } from '../../domain/image';
import type { MessageKey } from '../../lib/i18n/messages';
import { tr } from '../../lib/i18n/messages';

/** Localized explanation for an import that added no accounts. */
export function getImportFailureMessage(
  result: Pick<ImportResult, 'skipped' | 'errors'>
): string {
  return (
    result.errors[0] ??
    tr(result.skipped > 0 ? 'importAllDuplicates' : 'importNoneFound')
  );
}

/** Translate decoder diagnostics at the UI boundary, preserving other import errors. */
export function localizeQrError(
  message: string,
  translate: (key: MessageKey) => string
): string {
  switch (message) {
    case QR_DECODE_ERROR:
    case 'No QR code was found near that click or in the selected area.':
      return translate('qrNotFound');
    case QR_IMAGE_TOO_LARGE_ERROR:
      return translate('qrImageTooLarge');
    case 'Select 20 or fewer QR images at a time.':
    case 'Select 20 or fewer files at a time.':
      return translate('qrFileLimit');
    case 'Canvas rendering is unavailable.':
      return translate('qrUnavailable');
    default:
      return message;
  }
}
