import { cameraWindowBounds } from "./windowPlacement";
export const TOUCH_ID_HOST = "local.authenticator_workspace.touchid";
export type TouchIDErrorCode =
  "bridge" | "cancelled" | "locked" | "notEnrolled" | "unavailable" | "failed";
export class TouchIDError extends Error {
  constructor(readonly code: TouchIDErrorCode) {
    super(code);
  }
}
export function isMac(): boolean {
  return /Mac/.test(navigator.platform || navigator.userAgent);
}
export async function nativeTouchID(
  action: "status" | "authenticate",
  reason?: string,
): Promise<void> {
  if (
    !isMac() ||
    typeof chrome === "undefined" ||
    !chrome.runtime?.sendNativeMessage
  )
    throw new TouchIDError("unavailable");
  const nonce = Array.from(
    crypto.getRandomValues(new Uint8Array(32)),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
  const host = chrome.runtime.getURL("").startsWith("safari-web-extension:")
    ? "local.Authenticator-Workspace"
    : TOUCH_ID_HOST;
  const response = await new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TouchIDError("failed")), 90_000);
    try {
      chrome.runtime.sendNativeMessage(
        host,
        { version: 1, action, nonce, reason },
        (value: unknown) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) reject(new TouchIDError("bridge"));
          else resolve(value);
        },
      );
    } catch {
      clearTimeout(timer);
      reject(new TouchIDError("bridge"));
    }
  });
  if (!response || typeof response !== "object")
    throw new TouchIDError("failed");
  const result = response as Record<string, unknown>;
  if (result.version !== 1 || result.nonce !== nonce)
    throw new TouchIDError("failed");
  if (result.error) {
    const allowed = ["cancelled", "locked", "notEnrolled", "unavailable"];
    throw new TouchIDError(
      typeof result.error === "string" && allowed.includes(result.error)
        ? (result.error as TouchIDErrorCode)
        : "failed",
    );
  }
  if (
    result.supported !== true ||
    (action === "authenticate" && result.verified !== true)
  )
    throw new TouchIDError("failed");
}
export async function touchID(
  action: "status" | "authenticate",
  reason?: string,
): Promise<void> {
  if (!isMac()) throw new TouchIDError("unavailable");
  await new Promise<void>((resolve, reject) =>
    chrome.runtime.sendMessage(
      { kind: "touch-id", action, reason },
      (reply: { ok: boolean; error?: string } | undefined) => {
        if (chrome.runtime.lastError) {
          reject(new TouchIDError("bridge"));
          return;
        }
        if (reply?.ok) {
          resolve();
          return;
        }
        const codes = [
          "bridge",
          "cancelled",
          "locked",
          "notEnrolled",
          "unavailable",
          "failed",
        ];
        reject(
          new TouchIDError(
            reply?.error && codes.includes(reply.error)
              ? (reply.error as TouchIDErrorCode)
              : "failed",
          ),
        );
      },
    ),
  );
}
// Native authentication can dismiss a toolbar popup, so use a persistent extension window.
export async function touchIDWindow(setup = false): Promise<boolean> {
  if (!chrome.extension?.getViews?.({ type: "popup" }).includes(window))
    return false;
  const current = await chrome.windows.getCurrent();
  const url = new URL(chrome.runtime.getURL("index.html"));
  if (setup) url.searchParams.set("open", "passkey");
  else url.searchParams.set("entry", "touchID");
  if (current.id !== undefined) {
    url.searchParams.set("source", String(current.id));
    url.searchParams.set("window", String(current.id));
  }
  const area = window.screen as Screen & {
    availLeft?: number;
    availTop?: number;
  };
  const bounds =
    area?.availWidth > 0 && area?.availHeight > 0
      ? cameraWindowBounds(
          current,
          {
            left: area.availLeft ?? 0,
            top: area.availTop ?? 0,
            width: area.availWidth,
            height: area.availHeight,
          },
          370,
          85,
          680,
        )
      : { width: 370, height: 680 };
  await chrome.windows.create({ url: url.href, type: "popup", ...bounds });
  window.close();
  return true;
}
