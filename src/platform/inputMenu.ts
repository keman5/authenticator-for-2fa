import { DOCUMENT_KEY, readWorkspace } from "./repository";
export const INPUT_MENU_ORIGINS = ["http://*/*", "https://*/*"];
export async function requestInputMenuAccess(): Promise<boolean> {
  return (
    typeof chrome !== "undefined" &&
    Boolean(chrome.permissions?.request) &&
    chrome.permissions.request({ origins: INPUT_MENU_ORIGINS })
  );
}

export function installInputMenu() {
  if (
    !chrome.permissions?.contains ||
    !chrome.scripting?.registerContentScripts
  )
    return;
  const id = "authenticator-workspace-input";
  let pending = Promise.resolve();
  let previous: boolean | undefined;
  const refresh = (
    changes?: Record<string, chrome.storage.StorageChange>,
    area?: string,
  ) => {
    if (area && (area !== "local" || !changes?.[DOCUMENT_KEY])) return;
    pending = pending
      .then(async () => {
        const [workspace, allowed] = await Promise.all([
          readWorkspace(),
          chrome.permissions.contains({ origins: INPUT_MENU_ORIGINS }),
        ]);
        const enabled = Boolean(allowed && workspace.preferences.inputMenu);
        if (previous === enabled) return;
        const installed = await chrome.scripting.getRegisteredContentScripts({
          ids: [id],
        });
        if (enabled && !installed.length)
          await chrome.scripting.registerContentScripts([
            {
              id,
              matches: INPUT_MENU_ORIGINS,
              js: ["assets/injected.js"],
              runAt: "document_idle",
            },
          ]);
        if (!enabled && installed.length)
          await chrome.scripting.unregisterContentScripts({ ids: [id] });
        const tabs = await chrome.tabs.query({});
        await Promise.allSettled(
          tabs
            .filter(
              (tab) => tab.id !== undefined && /^https?:/.test(tab.url ?? ""),
            )
            .map(async (tab) => {
              if (enabled)
                await chrome.scripting.executeScript({
                  target: { tabId: tab.id! },
                  files: ["assets/injected.js"],
                });
              else
                await chrome.tabs.sendMessage(tab.id!, {
                  kind: "input-menu:refresh",
                });
            }),
        );
        previous = enabled;
      })
      .catch(() => {});
  };
  const permission = () => refresh();
  chrome.permissions.onAdded?.addListener(permission);
  chrome.permissions.onRemoved?.addListener(permission);
  chrome.storage.onChanged.addListener(refresh);
  refresh();
}
