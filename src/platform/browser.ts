export function shortcutsPage(url: string, agent: string): string | null {
  if (url.startsWith("safari-web-extension:")) return null;
  if (url.startsWith("moz-extension:")) return "about:addons";
  return agent.includes("Edg/")
    ? "edge://extensions/shortcuts"
    : "chrome://extensions/shortcuts";
}
export async function openShortcutSettings(): Promise<void> {
  const commands = chrome.commands as typeof chrome.commands & {
    openShortcutSettings?: () => Promise<void>;
  };
  if (commands?.openShortcutSettings) {
    await commands.openShortcutSettings();
    return;
  }
  const url = shortcutsPage(chrome.runtime.getURL(""), navigator.userAgent);
  if (url) await chrome.tabs.create({ url });
}
export function sourceWindow(): number | undefined {
  const value = new URL(location.href).searchParams.get("source");
  if (!value) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}
export function requiresFileWindow(isPopup: boolean): boolean {
  return isPopup;
}
export function fileWindowBounds(
  x: number,
  y: number,
  screen: Pick<Screen, "availWidth" | "availHeight"> & {
    availLeft?: number;
    availTop?: number;
  },
  browser?: { left?: number; top?: number; width?: number },
) {
  const left = screen.availLeft ?? 0;
  const top = screen.availTop ?? 0;
  const width = Math.min(380, screen.availWidth);
  if (
    browser?.left !== undefined &&
    browser.top !== undefined &&
    browser.width !== undefined
  ) {
    const windowTop = Math.round(
      Math.max(top, Math.min(browser.top + 85, top + screen.availHeight - 1)),
    );
    return {
      left: Math.round(
        Math.max(
          left,
          Math.min(
            browser.left + browser.width - width,
            left + screen.availWidth - width,
          ),
        ),
      ),
      top: windowTop,
      width,
      height: Math.min(720, top + screen.availHeight - windowTop),
    };
  }
  const height = Math.min(720, screen.availHeight);
  return {
    left: Math.round(
      Math.max(left, Math.min(x, left + screen.availWidth - width)),
    ),
    top: Math.round(
      Math.max(top, Math.min(y, top + screen.availHeight - height)),
    ),
    width,
    height,
  };
}
export async function request<T>(
  kind: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage)
    throw new Error("Extension API unavailable");
  return new Promise((resolve, reject) =>
    chrome.runtime.sendMessage(
      { kind, ...payload },
      (reply: { ok: boolean; value?: T; error?: string } | undefined) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else if (!reply?.ok)
          reject(new Error(reply?.error ?? "Request failed"));
        else resolve(reply.value as T);
      },
    ),
  );
}
export async function tryFill(code: string, source?: number): Promise<boolean> {
  try {
    return await request<boolean>("fill", { code, source });
  } catch {
    return false;
  }
}
export async function openFileWindow(): Promise<void> {
  if (
    typeof chrome === "undefined" ||
    !chrome.extension?.getViews?.({ type: "popup" }).includes(window)
  )
    return;
  const current = await chrome.windows.getCurrent();
  const bounds = fileWindowBounds(
    window.screenX,
    window.screenY,
    window.screen,
    location.protocol === "moz-extension:" ? current : undefined,
  );
  const url = new URL(chrome.runtime.getURL("index.html"));
  url.searchParams.set("view", "data");
  if (current.id !== undefined)
    url.searchParams.set("source", String(current.id));
  const created = await chrome.windows.create({
    url: url.href,
    type: "popup",
    ...bounds,
  });
  if (created?.id !== undefined) window.close();
}
