import interfaceMessages from "./interface.json";
import {
  messages as workspaceMessages,
  translate as workspaceCopy,
} from "../../domain/workspaceCopy";
import { MESSAGE_KEYS, t, type MessageKey } from "./messages";

const errorKeys: Record<string, MessageKey> = {
  "Password protection is off.": "noticeProtectionOff",
  "Password protection is already off.": "noticeProtectionOff",
  "Vault locked.": "noticeLocked",
  "Vault password changed.": "noticePasswordSet",
  "Vault password set.": "noticePasswordSet",
  "Vault password removed.": "noticePasswordRemoved",
  "Settings saved.": "noticeSaved",
  "Account updated.": "noticeSaved",
  "Account added.": "noticeSaved",
  "Account removed.": "noticeAccountRemoved",
  "No new account was imported. It may already exist.": "importAllDuplicates",
  "No account was found to import.": "importNoneFound",
  "Page scan failed.": "scanPageFailed",
  "Page scan decoding is unavailable here.": "scanPageFailed",
  "Page scan cancelled.": "cancel",
  "No scan area was selected.": "scanPageFailed",
  "No active tab is available to scan.": "scanPageFailed",
  "Page scan is unavailable on internal or extension pages.": "scanPageFailed",
  "Auto-paste code is invalid.": "copyFailed",
  "No active tab is available for auto-paste.": "copyFailed",
  "Auto-paste is unavailable on internal or extension pages.": "copyFailed",
  "Auto-paste failed.": "copyFailed",
  "Paste code is invalid.": "copyFailed",
  "Unable to paste the code.": "copyFailed",
  "No QR code could be decoded from the selected image. Use a clear image with the whole QR code visible.":
    "qrNotFound",
  "No QR code was found near that click or in the selected area.": "qrNotFound",
  "Selected image is too large to scan as a QR code.": "qrImageTooLarge",
  "Canvas rendering is unavailable.": "qrUnavailable",
  "Select 20 or fewer QR images at a time.": "qrFileLimit",
  "Select 20 or fewer files at a time.": "qrFileLimit",

  "Unlock before changing accounts.": "unlockRequired",
  "This account already exists.": "importAllDuplicates",
  "Invalid account data.": "dataInvalid",
  "Saved data could not be read.": "dataInvalid",
  "This action is unavailable.": "actionFailed",
  "This account changed in another window. Reopen it and try again.":
    "accountChanged",
  "Use at least 1 character.": "passwordHint",
  "Incorrect password.": "passwordIncorrect",
  invalid: "dataInvalid",
  corrupt: "dataInvalid",
  unavailable: "qrUnavailable",
  emptyPassword: "passwordHint",
  "Account name is required.": "accountNameRequired",
  "Secret is too short.": "secretInvalid",
  "Backup password is incorrect.": "backupPasswordWrong",
  "Secret must be Base32 using A-Z and 2-7.": "secretInvalid",
  "Unsupported OTP type.": "otpParametersInvalid",
  "Digits must be between 5 and 10.": "otpParametersInvalid",
  "Period must be between 5 and 300 seconds.": "otpParametersInvalid",
  "Counter must be a positive whole number.": "otpParametersInvalid",
  "This account changed. Reopen it and try again.": "accountChanged",
  "Vault password must be at least 1 character.": "passwordHint",
  "Turn off Browser Sync before removing password protection.":
    "syncProtectionHint",
  "Browser Sync requires a password-protected vault.": "syncProtectionRequired",
  "Browser Sync recovery key is not valid.": "syncWrongKey",
  "Browser Sync account exceeds the storage limit.": "syncQuota",
  "No encrypted vault exists yet.": "syncProtectionRequired",
  "Set a vault password and unlock it before registering a passkey.":
    "syncProtectionRequired",
  "Unlock the vault before making changes.": "unlockRequired",
  "Unlock the vault before importing the scanned QR code.": "unlockRequired",
  "File is too large to import.": "fileTooLarge",
  "File could not be read.": "fileUnreadable",
  "No accounts were found to import.": "importNoneFound",
  "No new accounts were imported.": "importAllDuplicates",
};
/** Translate domain diagnostics only at presentation, without changing stored data/errors. */
export function localizeFeedback(language: string, message: string): string {
  const labels =
    interfaceMessages[
      (language === "zh" ? "zh-CN" : language) as keyof typeof interfaceMessages
    ] ?? interfaceMessages.en;
  const translate = (key: MessageKey) => t(language, key);
  if (!message) return "";
  if (Object.hasOwn(errorKeys, message)) return translate(errorKeys[message]);
  if (
    message === "Current password is incorrect." ||
    message === "Unlock failed. Check the password and try again."
  )
    return t(language, "passwordIncorrect");
  const imported = message.match(/^(\d+) accounts? imported\.$/);
  if (imported) return t(language, "importAddedCount", { count: imported[1] });
  if (message.startsWith("Invalid Base32 character "))
    return translate("secretInvalid");
  if (
    /^Unsupported OTP (?:type|algorithm) /.test(message) ||
    message.endsWith("must be a non-negative whole number.")
  )
    return translate("otpParametersInvalid");
  if (
    /passkey|WebAuthn|credential/i.test(message) &&
    !isLocalized(message, language, labels)
  )
    return translate("passkeyFailed");
  if (
    /^(?:Imported account|Backup file|Only otpauth|otpauth URI|Authenticator migration|Migration URI|Invalid protobuf|Protobuf|Unexpected end of protobuf|Unsupported protobuf|Unexpected token|Unexpected end of JSON|Invalid URL|Vault encryption parameters|Stored vault)/.test(
      message,
    )
  )
    return translate("dataInvalid");
  if (message.includes("\n"))
    return message
      .split("\n")
      .map((line) => localizeFeedback(language, line))
      .join("\n");
  // Import errors can be prefixed with a user-selected filename.
  const fileError = message.match(
    /^(.*): (File is too large to import\.|File could not be read\.)$/,
  );
  if (fileError)
    return `${fileError[1]}: ${localizeFeedback(language, fileError[2])}`;
  return isLocalized(message, language, labels)
    ? message
    : translate("actionFailed");
}

function isLocalized(
  message: string,
  language: string,
  labels: typeof interfaceMessages.en,
): boolean {
  return [
    ...MESSAGE_KEYS.map((key) => t(language, key)),
    ...Object.values(labels),
    ...Object.keys(workspaceMessages).map((key) =>
      workspaceCopy(language, key as keyof typeof workspaceMessages),
    ),
  ].some((template) => {
    const pattern = template
      .split(/\{\w+\}/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\s\\S]*");
    return new RegExp(`^${pattern}$`).test(message);
  });
}
