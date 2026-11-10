import { encryptedBackup, isProtectedBackup, openBackup } from "./sealing";
import { parseTransfer, toUri } from "./transfer";
import {
  toCredential,
  toAccount,
  type AuthenticatorAccount,
  type AppSettings,
} from "./view";
export interface ExportFile {
  filename: string;
  blob: Blob;
}
export function readPortableBackup(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return isProtectedBackup(value) ? value : null;
  } catch {
    return null;
  }
}
export async function createEncryptedBackupFile(
  accounts: AuthenticatorAccount[],
  _settings: AppSettings,
  password: string,
): Promise<ExportFile> {
  return {
    filename: "authenticator-backup.2fa",
    blob: new Blob(
      [
        await encryptedBackup(
          {
            app: "2fa-authenticator",
            version: 1,
            records: accounts.map((item) => ({
              ...toCredential(item),
              id: item.id,
            })),
          },
          password,
        ),
      ],
      { type: "application/json" },
    ),
  };
}
export function createPlainOtpAuthFile(
  accounts: AuthenticatorAccount[],
): ExportFile {
  return {
    filename: "authenticator-accounts.txt",
    blob: new Blob(
      [accounts.map((item) => toUri(toCredential(item))).join("\n")],
      { type: "text/plain" },
    ),
  };
}
export async function readBackupAccounts(
  text: string,
  password: string,
): Promise<AuthenticatorAccount[]> {
  const value = await openBackup(JSON.parse(text) as unknown, password);
  return (await parseTransfer(JSON.stringify(value))).map(toAccount);
}
export function downloadFile(file: ExportFile): void {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
