import {
  identify,
  normalizeSecret,
  validateCredential,
  type Credential,
} from "./records";
import { detectBrowserLanguage } from "../lib/i18n/languages";
export type OtpType = Credential["mode"];
export type OtpAlgorithm = Credential["hash"];
export interface AuthenticatorAccount extends Pick<
  Credential,
  "id" | "secret" | "digits" | "counter" | "favorite"
> {
  issuer: Credential["provider"];
  label: Credential["login"];
  type: OtpType;
  algorithm: OtpAlgorithm;
  period: Credential["interval"];
  site?: string;
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
}
export type AccountDraft = Pick<AuthenticatorAccount, "label" | "secret"> &
  Partial<
    Omit<
      AuthenticatorAccount,
      "label" | "secret" | "id" | "createdAt" | "updatedAt"
    >
  >;
export interface AppSettings {
  language: string;
  languageMode?: "system" | "manual";
  theme: "system" | "light" | "dark";
  hideCodes: boolean;
  showCountdownSeconds: boolean;
  autoPasteCodes: boolean;
  alwaysShowAllCodes: boolean;
  accountSortMode: "manual" | "contextual";
  autoLockMinutes?: number;
  enhancedInputMenu?: boolean;
  passkeyDefault?: boolean;
  lastBackupAt?: string;
}
export interface OtpCode {
  accountId: AuthenticatorAccount["id"];
  value: string;
  /** Seconds until the next TOTP interval; zero for HOTP. */
  remaining: number;
  progress: number;
}
export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  accounts: AuthenticatorAccount[];
}
export const OTP_TYPES: OtpType[] = ["totp", "hotp", "steam"];
export const OTP_ALGORITHMS: OtpAlgorithm[] = ["SHA-1", "SHA-256", "SHA-512"];
export const DEFAULT_SETTINGS: AppSettings = {
  language: "en",
  languageMode: "system",
  theme: "system",
  hideCodes: true,
  showCountdownSeconds: true,
  autoPasteCodes: false,
  alwaysShowAllCodes: false,
  accountSortMode: "contextual",
  autoLockMinutes: 0,
  enhancedInputMenu: true,
  passkeyDefault: false,
};
export const createDefaultAppSettings = (): AppSettings => ({
  ...DEFAULT_SETTINGS,
  language: detectBrowserLanguage(),
});
export function toAccount(item: Credential): AuthenticatorAccount {
  const date = new Date(item.changed || 0).toISOString();
  return {
    id: item.id,
    issuer: item.provider,
    label: item.login,
    secret: item.secret,
    type: item.mode,
    algorithm: item.hash,
    digits: item.digits,
    period: item.interval,
    counter: item.counter,
    site: item.site,
    sortOrder: item.position,
    favorite: item.favorite === true,
    createdAt: date,
    updatedAt: date,
  };
}
export function toCredential(item: AccountDraft, old?: Credential): Credential {
  if (!item.label.trim()) throw new Error("Account name is required.");
  try {
    normalizeSecret(item.secret);
  } catch {
    throw new Error("Secret must be Base32 using A-Z and 2-7.");
  }
  return validateCredential({
    ...old,
    provider: item.issuer,
    login: item.label,
    secret: item.secret,
    mode: item.type,
    hash: item.algorithm,
    digits: item.digits,
    interval: item.period,
    counter: item.counter,
    site: item.site,
    position: item.sortOrder ?? old?.position,
    favorite: item.favorite,
  });
}
export async function accountDraft(
  item: AccountDraft,
): Promise<AuthenticatorAccount> {
  return toAccount(await identify(toCredential(item)));
}
