import { InputError } from "./records";
export class AccountChangedError extends Error {
  constructor() {
    super("This account changed in another window. Reopen it and try again.");
  }
}
export function getErrorMessage(
  error: unknown,
  fallback = "The action failed.",
): string {
  if (error instanceof InputError)
    return {
      password: "Incorrect password.",
      emptyPassword: "Use at least 1 character.",
      invalid: "Invalid account data.",
      corrupt: "Saved data could not be read.",
      quota: "Browser sync storage is full.",
      unavailable: "This action is unavailable.",
      stale: "This account changed in another window. Reopen it and try again.",
      missingGroup: "No sync group was found for this recovery key.",
    }[error.code];
  return error instanceof Error && error.message ? error.message : fallback;
}
