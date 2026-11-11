import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  installMemoryStorage,
  installStructuredCloneChromeStorage,
} from "../helpers/storage";
type Listener = (
  request: unknown,
  sender: chrome.runtime.MessageSender,
  reply: (value: unknown) => void,
) => unknown;
let listeners: Listener[];
const app = { id: "test", url: "chrome-extension://test/index.html" };
const content = {
  id: "test",
  url: "https://instagram.com/login",
  frameId: 0,
  tab: { id: 1, windowId: 2 },
} as chrome.runtime.MessageSender;
beforeEach(async () => {
  vi.resetModules();
  installMemoryStorage();
  installStructuredCloneChromeStorage();
  listeners = [];
  Object.assign(chrome.runtime, {
    id: "test",
    getURL: (path: string) => "chrome-extension://test/" + path,
    sendMessage: vi.fn(async () => {}),
    onMessage: {
      addListener: (listener: Listener) => listeners.push(listener),
    },
  });
  Object.assign(chrome, {
    commands: { onCommand: { addListener: vi.fn() } },
    tabs: {
      query: vi.fn(async () => [{ id: 1, url: "https://instagram.com" }]),
      sendMessage: vi.fn(async () => true),
      onActivated: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn() },
    },
    scripting: { executeScript: vi.fn(async () => []) },
    permissions: { contains: vi.fn(async () => true) },
  });
  await import("../../src/worker");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function request(message: unknown, sender: chrome.runtime.MessageSender = app) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    for (const listener of listeners)
      if (
        listener(message, sender, (value) =>
          resolve(value as Record<string, unknown>),
        ) === true
      )
        return;
    reject(new Error("No handler"));
  });
}
async function accountWorkspace() {
  const { transaction } = await import("../../src/platform/repository");
  const { identify, insertRecords, validateCredential } =
    await import("../../src/domain/records");
  const accounts = await Promise.all(
    ["Instagram", "GitHub"].map((provider) =>
      identify(
        validateCredential({
          provider,
          login: "alice",
          secret: "JBSWY3DPEHPK3PXP",
        }),
      ),
    ),
  );
  await transaction((space) => {
    insertRecords(space, accounts);
    space.preferences.inputMenu = true;
  });
  return accounts;
}
test("UI messages reject other extensions and web-page senders", async () => {
  for (const sender of [{ id: "other", url: app.url }, content])
    expect(
      (await request({ type: "paste-code", code: "123456" }, sender)).ok,
    ).toBe(false);
  expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
});
test("site icons are only read for the requested active site and never for private tabs", async () => {
  const icon = "data:image/png;base64,iVBORw0KGgo=";
  const tab = {
    id: 1,
    index: 0,
    pinned: false,
    highlighted: true,
    active: true,
    windowId: 2,
    incognito: false,
    selected: true,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    url: "https://instagram.com/login",
    favIconUrl: "https://instagram.com/icon.png",
  };
  const query = vi.fn(async () => [tab]);
  const executeScript = vi.fn(async () => [{ frameId: 0, result: icon }]);
  Object.assign(chrome.tabs, { query });
  Object.assign(chrome.scripting, { executeScript });
  const message = { kind: "site-icon", hostname: "instagram.com", source: 2 };
  expect((await request(message, content)).ok).toBe(false);
  expect(
    (await request({ ...message, hostname: "example.com" })).value,
  ).toBeNull();
  expect((await request(message)).value).toBe(icon);
  expect(chrome.scripting.executeScript).toHaveBeenCalledExactlyOnceWith({
    target: { tabId: 1 },
    func: expect.any(Function),
    args: ["https://instagram.com", "https://instagram.com/icon.png"],
  });
  query.mockResolvedValue([{ ...tab, incognito: true }]);
  expect((await request(message)).value).toBeNull();
  expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
});
test("locked workspaces reject fill and screen capture before injecting or reading images", async () => {
  const { transaction } = await import("../../src/platform/repository");
  const { newGate } = await import("../../src/domain/sealing");
  await transaction(async (space) => {
    space.gate = await newGate("1");
  });
  expect((await request({ type: "paste-code", code: "123456" })).ok).toBe(
    false,
  );
  expect(
    (
      await request(
        { kind: "capture", x: 0, y: 0, width: 10, height: 10, viewport: 100 },
        content,
      )
    ).ok,
  ).toBe(false);
  expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
});
test("page filling injects the packaged standalone script and only accepts OTP formats", async () => {
  expect(
    (await request({ type: "paste-code", code: "123456", windowId: 2 })).pasted,
  ).toBe(true);
  expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
    target: { tabId: 1 },
    files: ["assets/injected.js"],
  });
  vi.mocked(chrome.scripting.executeScript).mockClear();
  expect((await request({ type: "paste-code", code: "password" })).ok).toBe(
    false,
  );
  expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
});
test("page menus expose matched labels without secrets and issue a code only for the selected match", async () => {
  const accounts = await accountWorkspace();
  const response = await request({ type: "input-menu:accounts" }, content);
  expect(response.accounts).toEqual([
    {
      id: accounts[0]!.id,
      issuer: "Instagram",
      label: "alice",
      digits: 6,
      period: 30,
    },
  ]);
  expect(response.countdown).toEqual({ period: 30, offsetMs: 0 });
  expect(JSON.stringify(response)).not.toContain("JBSWY");
  expect(
    (
      await request(
        { type: "input-menu:code", accountId: accounts[0]!.id },
        content,
      )
    ).code,
  ).toMatch(/^\d{6}$/);
  expect(
    (
      await request(
        { type: "input-menu:code", accountId: accounts[1]!.id },
        content,
      )
    ).ok,
  ).toBe(false);
  expect(
    (await request({ type: "input-menu:accounts" }, { ...content, frameId: 1 }))
      .ok,
  ).toBe(false);
});
test("page-menu countdown follows corrected time and skips counter-based accounts", async () => {
  const accounts = await accountWorkspace();
  const { TIME_CALIBRATION_KEY } = await import("../../src/platform/time");
  await new Promise<void>((resolve) =>
    chrome.storage.local.set(
      { [TIME_CALIBRATION_KEY]: { offsetMs: 4500, calibratedAt: Date.now() } },
      resolve,
    ),
  );
  expect(
    (await request({ type: "input-menu:accounts" }, content)).countdown,
  ).toEqual({ period: 30, offsetMs: 4500 });
  const { transaction } = await import("../../src/platform/repository");
  await transaction((space) => {
    space.records[accounts[0]!.id]!.mode = "hotp";
  });
  expect(
    (await request({ type: "input-menu:accounts" }, content)).countdown,
  ).toBeUndefined();
});
test("permission revocation or disabling prevents page menu access", async () => {
  await accountWorkspace();
  vi.mocked(chrome.permissions.contains).mockImplementation(
    (async () => false) as typeof chrome.permissions.contains,
  );
  expect((await request({ type: "input-menu:accounts" }, content)).ok).toBe(
    false,
  );
  vi.mocked(chrome.permissions.contains).mockImplementation(
    (async () => true) as typeof chrome.permissions.contains,
  );
  const { transaction } = await import("../../src/platform/repository");
  await transaction((space) => {
    space.preferences.inputMenu = false;
  });
  expect((await request({ type: "input-menu:accounts" }, content)).ok).toBe(
    false,
  );
});
test("a code finishing after locking is not returned to a page", async () => {
  const accounts = await accountWorkspace();
  const otp = await import("../../src/domain/otp");
  let resolve!: (value: string) => void;
  vi.spyOn(otp, "codeFor").mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const pending = request(
    { type: "input-menu:code", accountId: accounts[0]!.id },
    content,
  );
  await vi.waitFor(() => expect(otp.codeFor).toHaveBeenCalled());
  const { transaction } = await import("../../src/platform/repository");
  const { newGate } = await import("../../src/domain/sealing");
  await transaction(async (space) => {
    space.gate = await newGate("1");
  });
  resolve("123456");
  expect((await pending).ok).toBe(false);
});
test("page scan cancellation broadcasts an ordinary cancelled result", async () => {
  expect((await request({ kind: "scan-cancel" }, content)).ok).toBe(true);
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "page-scan:completed",
      windowId: 2,
      cancelled: true,
      ok: false,
    }),
  );
  expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
});

test("page menu OTP uses the same stored time correction as the account list", async () => {
  const local = Date.UTC(2026, 10, 9);
  vi.spyOn(Date, "now").mockReturnValue(local);
  const accounts = await accountWorkspace();
  const { TIME_CALIBRATION_KEY } = await import("../../src/platform/time");
  await new Promise<void>((resolve) =>
    chrome.storage.local.set(
      {
        [TIME_CALIBRATION_KEY]: { offsetMs: 61000, calibratedAt: local },
      },
      resolve,
    ),
  );
  const { codeFor } = await import("../../src/domain/otp");
  expect(
    (
      await request(
        { type: "input-menu:code", accountId: accounts[0]!.id },
        content,
      )
    ).code,
  ).toBe(await codeFor(accounts[0]!, local + 61000));
});
