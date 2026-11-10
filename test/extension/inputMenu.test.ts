// @vitest-environment jsdom
import { afterEach, expect, test, vi, type MockInstance } from "vitest";
import { installStructuredCloneChromeStorage } from "../helpers/storage";

type Listener = (
  value: unknown,
  sender: chrome.runtime.MessageSender,
  reply: (value: unknown) => void,
) => unknown;
let listeners: Listener[] = [];
const observers: MutationObserver[] = [];
let documentListeners: MockInstance<typeof document.addEventListener>;
let windowListeners: MockInstance<typeof window.addEventListener>;
const sender = {
  id: "test",
  url: "https://example.com/login",
  frameId: 0,
  tab: { id: 1, windowId: 2 },
} as chrome.runtime.MessageSender;

afterEach(() => {
  listeners.forEach((listener) =>
    listener({ kind: "input-menu:refresh" }, sender, () => {}),
  );
  observers.splice(0).forEach((observer) => observer.disconnect());
  for (const [type, listener, options] of documentListeners.mock.calls)
    document.removeEventListener(type, listener, options);
  for (const [type, listener, options] of windowListeners.mock.calls)
    window.removeEventListener(type, listener, options);
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test.each(["hotp", "totp"] as const)(
  "locking clears an already revealed %s from the page, and unlocking offers it again",
  async (type) => {
    vi.resetModules();
    installStructuredCloneChromeStorage();
    listeners = [];
    documentListeners = vi.spyOn(document, "addEventListener");
    windowListeners = vi.spyOn(window, "addEventListener");
    // oxlint-disable-next-line typescript/unbound-method
    const observe = MutationObserver.prototype.observe;
    vi.spyOn(MutationObserver.prototype, "observe").mockImplementation(
      function (this: MutationObserver, ...args) {
        observers.push(this);
        observe.apply(this, args);
      },
    );
    const dispatch = (value: unknown) =>
      new Promise<unknown>((resolve) => {
        for (const listener of listeners)
          if (listener(value, sender, resolve) === true) return;
        resolve(undefined);
      });
    Object.assign(chrome.runtime, {
      id: "test",
      getURL: (path: string) => "chrome-extension://test/" + path,
      onMessage: {
        addListener: (listener: Listener) => listeners.push(listener),
      },
      sendMessage: (value: unknown, callback?: (value: unknown) => void) =>
        dispatch(value).then((result) => {
          callback?.(result);
          return result;
        }),
    });
    Object.assign(chrome, {
      tabs: {
        query: vi.fn(async () => [{ id: 1, url: sender.url }]),
        sendMessage: vi.fn(async (_id: number, value: unknown) => {
          listeners.forEach((listener) => listener(value, sender, () => {}));
        }),
        onActivated: { addListener: vi.fn() },
        onUpdated: { addListener: vi.fn() },
      },
      permissions: { contains: vi.fn(async () => true) },
      scripting: {
        getRegisteredContentScripts: vi.fn(async () => []),
        registerContentScripts: vi.fn(async () => {}),
        executeScript: vi.fn(async () => []),
      },
    });
    const { AuthenticatorVault } =
      await import("../../src/platform/controller");
    const vault = new AuthenticatorVault();
    await vault.initialize();
    await vault.addAccount({
      issuer: "Example",
      label: "alice",
      site: "example.com",
      secret: "JBSWY3DPEHPK3PXP",
      type,
    });
    await vault.changePassword("", "1");
    await vault.updateSettings({ enhancedInputMenu: true });
    await import("../../src/worker");
    let root!: ShadowRoot;
    // oxlint-disable-next-line typescript/unbound-method
    const attach = HTMLElement.prototype.attachShadow;
    vi.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(
      function (this: HTMLElement, options) {
        root = attach.call(this, options);
        return root;
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 10,
      left: 10,
      top: 10,
      right: 200,
      bottom: 50,
      width: 190,
      height: 40,
      toJSON() {},
    });
    vi.stubGlobal("__authenticator2FAInstalled", false);
    document.body.innerHTML = '<input autocomplete="one-time-code">';
    await import("../../src/injected");
    await vi.waitFor(() =>
      expect(
        document.querySelector("[data-authenticator-menu]"),
      ).not.toBeNull(),
    );
    root
      .querySelector("[data-authenticator-trigger]")!
      .dispatchEvent(new Event("pointerenter"));
    root
      .querySelector("[data-authenticator-account]")!
      .dispatchEvent(new Event("pointerenter"));
    await vi.waitFor(() =>
      expect(
        root.querySelector("[data-authenticator-code]")!.textContent,
      ).toMatch(/^\d{6}$/),
    );
    await vault.lock();
    expect(vault.locked).toBe(true);
    await vi.waitFor(() =>
      expect(document.querySelector("[data-authenticator-menu]")).toBeNull(),
    );
    expect(
      await dispatch({ type: "input-menu:code", accountId: "anything" }),
    ).toMatchObject({ ok: false });
    await vault.unlock("1");
    await vi.waitFor(() =>
      expect(
        document.querySelector("[data-authenticator-menu]"),
      ).not.toBeNull(),
    );
    expect(root.querySelector("[data-authenticator-code]")!.textContent).toBe(
      "******",
    );
  },
);
