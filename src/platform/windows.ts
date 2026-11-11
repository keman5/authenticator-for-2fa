import { cameraWindowBounds } from "./windowPlacement";
export type AppRoute =
  | "add-qr"
  | "add-screen"
  | "add-page"
  | "import"
  | "passkey"
  | "unlock-passkey";
const popup = () =>
  typeof chrome !== "undefined" &&
  typeof window !== "undefined" &&
  Boolean(chrome.extension?.getViews?.({ type: "popup" }).includes(window));
export const needsCameraWindow = popup;
export const needsFilePickerWindow = () =>
  popup() && new URL(window.location.href).protocol === "moz-extension:";
export const isCameraWindow = (url: string) =>
  new URL(url).searchParams.get("camera") === "1";
export function readAppRoute(url: string): AppRoute | null {
  const value = new URL(url).searchParams.get("open");
  return [
    "add-qr",
    "add-screen",
    "add-page",
    "import",
    "passkey",
    "unlock-passkey",
  ].includes(value ?? "")
    ? (value as AppRoute)
    : null;
}
export function closeScreenScanWindow() {
  const url = new URL(window.location.href);
  if (
    readAppRoute(url.href) === "add-screen" &&
    url.searchParams.get("temporaryScan") === "1"
  )
    window.close();
}
function api<T>(invoke: (done: (value: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) =>
    invoke((value) =>
      chrome.runtime.lastError
        ? reject(new Error(chrome.runtime.lastError.message))
        : resolve(value),
    ),
  );
}
export async function getPageWindowId(): Promise<number | undefined> {
  const value = new URL(window.location.href).searchParams.get("window");
  if (
    value !== null &&
    value !== "" &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) >= 0
  )
    return Number(value);
  if (typeof chrome === "undefined" || !chrome.windows?.getCurrent)
    return undefined;
  try {
    return (
      await api<chrome.windows.Window>((done) =>
        chrome.windows.getCurrent(done),
      )
    ).id;
  } catch {
    return undefined;
  }
}
export async function openAppWindow(
  route: AppRoute,
  surface: "window" | "browser-window" = "window",
) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("open", route);
  const sourceId = await getPageWindowId();
  if (sourceId !== undefined) {
    url.searchParams.set("window", String(sourceId));
    url.searchParams.set("source", String(sourceId));
  }
  if (route === "add-screen") url.searchParams.set("temporaryScan", "1");
  if (surface === "browser-window") url.searchParams.set("camera", "1");
  const width = route === "add-screen" ? 740 : 370,
    height = surface === "browser-window" ? 800 : 755;
  let bounds: Partial<chrome.windows.CreateData> = { width, height };
  if (window.screen?.availWidth > 0 && window.screen?.availHeight > 0) {
    let source: chrome.windows.Window | undefined;
    try {
      source =
        sourceId !== undefined && chrome.windows?.get
          ? await api((done) => chrome.windows.get(sourceId, done))
          : chrome.windows?.getCurrent
            ? await api((done) => chrome.windows.getCurrent(done))
            : undefined;
    } catch {
      /* Use the work area when the originating window no longer exists. */
    }
    const area = window.screen as Screen & {
      availLeft?: number;
      availTop?: number;
    };
    bounds = cameraWindowBounds(
      source,
      {
        left: area.availLeft ?? 0,
        top: area.availTop ?? 0,
        width: area.availWidth,
        height: area.availHeight,
      },
      width,
      85,
      height,
    );
  }
  if (chrome.windows?.create)
    await api((done) =>
      chrome.windows.create(
        {
          url: url.href,
          type: surface === "browser-window" ? "normal" : "popup",
          ...bounds,
        },
        done,
      ),
    );
  else await api((done) => chrome.tabs.create({ url: url.href }, done));
  window.close();
}
export async function focusCurrentAppWindow() {
  if (typeof chrome === "undefined" || !chrome.windows?.getCurrent) return;
  try {
    const current = await api<chrome.windows.Window>((done) =>
      chrome.windows.getCurrent(done),
    );
    if (current.id !== undefined)
      await api((done) =>
        chrome.windows.update(current.id!, { focused: true }, done),
      );
  } catch {
    /* Native screen pickers may outlive their originating window. */
  }
}
export async function focusExistingAppWindow(): Promise<boolean> {
  if (!popup() || !chrome.windows?.getAll) return false;
  try {
    const windows = await api<chrome.windows.Window[]>((done) =>
      chrome.windows.getAll({ populate: true }, done),
    );
    for (const item of windows) {
      const tab = item.tabs?.find((tab) => {
        if (!tab.url) return false;
        try {
          const url = new URL(tab.url),
            here = new URL(window.location.href);
          return (
            url.protocol === here.protocol &&
            url.host === here.host &&
            url.pathname === here.pathname
          );
        } catch {
          return false;
        }
      });
      if (item.id === undefined || tab?.id === undefined) continue;
      await api((done) => chrome.tabs.update(tab.id!, { active: true }, done));
      await api((done) =>
        chrome.windows.update(item.id!, { focused: true }, done),
      );
      window.close();
      return true;
    }
  } catch {
    /* A disappearing tab must not prevent opening the toolbar panel. */
  }
  return false;
}
