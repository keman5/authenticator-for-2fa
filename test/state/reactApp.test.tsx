// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../src/app/App";
import * as backup from "../../src/domain/portable";
import { generateSyncRecoveryKey } from "../../src/platform/sync";
import { t } from "../../src/lib/i18n/messages";
import { AuthenticatorVault } from "../../src/platform/controller";
import { installStructuredCloneChromeStorage } from "../helpers/storage";
import { createBrowserSyncNetwork } from "../helpers/browserSync";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  installStructuredCloneChromeStorage();
  Object.defineProperty(chrome.storage, "sync", {
    value: chrome.storage.local,
  });
  localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});
async function openApp() {
  const vault = new AuthenticatorVault();
  render(<App vault={vault} />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "All0" })).toBeTruthy(),
  );
  return vault;
}
test("bottom navigation resets content scroll including the current tab", async () => {
  const user = userEvent.setup();
  await openApp();
  const body = screen.getByRole("main");
  for (const name of ["Data", "Settings", "Settings", "Codes"]) {
    body.scrollTop = 300;
    await user.click(screen.getByRole("button", { name }));
    expect(body.scrollTop).toBe(0);
  }
});

test("manual create, favorite, copy and reopening use the same persisted real vault", async () => {
  const user = userEvent.setup();
  const vault = await openApp();
  await user.click(screen.getByRole("button", { name: "Add account" }));
  await user.click(screen.getByRole("button", { name: "Manual entry" }));
  await user.type(screen.getByLabelText("Name (site or service)"), "Example");
  await user.type(screen.getByLabelText("Account"), "alice@example.com");
  await user.type(screen.getByLabelText("Secret (Base32)"), "JBSWY3DPEHPK3PXP");
  await user.click(screen.getByRole("button", { name: "Save account" }));
  await screen.findByRole("button", {
    name: "Copy: Example alice@example.com",
  });
  expect(vault.accounts).toHaveLength(1);
  expect(document.querySelector(".confetti")).not.toBeNull();
  await user.click(
    screen.getByRole("button", { name: "Copy: Example alice@example.com" }),
  );
  expect(await navigator.clipboard.readText()).toBe(
    vault.codes[vault.accounts[0].id].value,
  );
  await user.click(
    screen.getByRole("button", { name: "Settings: Example alice@example.com" }),
  );
  await user.click(screen.getByRole("button", { name: "Favorite" }));
  await waitFor(() => expect(vault.accounts[0].favorite).toBe(true));
  const reopened = new AuthenticatorVault();
  await reopened.initialize();
  expect(reopened.accounts[0]).toMatchObject({
    label: "alice@example.com",
    favorite: true,
  });
});
test("only successful additions celebrate, not loading, duplicates, failures or edits", async () => {
  const vault = new AuthenticatorVault();
  await vault.initialize();
  await vault.addAccount({ label: "existing", secret: "JBSWY3DPEHPK3PXP" });
  render(<App vault={vault} />);
  await screen.findByRole("button", { name: "Copy: existing" });
  expect(document.querySelector(".confetti")).toBeNull();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Data" }));
  await user.click(screen.getByRole("button", { name: "Paste" }));
  const panel = screen.getByRole("region", { name: "Import" });
  const input = document.getElementById("import-text")!;
  for (const text of [
    "invalid",
    "otpauth://totp/existing?secret=JBSWY3DPEHPK3PXP",
  ]) {
    fireEvent.change(input, { target: { value: text } });
    await user.click(within(panel).getByRole("button", { name: "Import" }));
    await within(panel).findByRole("alert");
    expect(document.querySelector(".confetti")).toBeNull();
  }
  await user.click(screen.getByRole("button", { name: "Codes" }));
  await user.click(screen.getByRole("button", { name: "Settings: existing" }));
  await user.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.change(document.getElementById("account-label")!, {
    target: { value: "edited" },
  });
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", { name: "Copy: edited" });
  expect(document.querySelector(".confetti")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Data" }));
  await user.click(screen.getByRole("button", { name: "Paste" }));
  fireEvent.change(document.getElementById("import-text")!, {
    target: { value: "otpauth://totp/added?secret=JBSWY3DPEHPK3PXP" },
  });
  await user.click(
    within(screen.getByRole("region", { name: "Import" })).getByRole("button", {
      name: "Import",
    }),
  );
  await waitFor(() =>
    expect(document.querySelector(".confetti")).not.toBeNull(),
  );
  expect(vault.accounts).toHaveLength(2);
});

test("password protection locks away UI secrets, rejects wrong passwords and decrypts before reopening", async () => {
  const user = userEvent.setup();
  const vault = await openApp();
  await act(() =>
    vault.importText(
      "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example",
    ),
  );
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("button", { name: /UI password/ }));
  await user.type(
    screen.getByLabelText("New password"),
    "correct horse battery",
  );
  await user.type(
    screen.getByLabelText("Confirm password"),
    "correct horse battery",
  );
  await user.click(screen.getByRole("button", { name: "Save password" }));
  await waitFor(() => expect(vault.passwordProtected).toBe(true));
  await user.click(screen.getByRole("button", { name: "Lock" }));
  await screen.findByRole("heading", { name: "Locked" });
  expect(screen.queryByText("alice")).toBeNull();
  await user.type(screen.getByLabelText("Password"), "wrong-password");
  await user.click(screen.getByRole("button", { name: "Unlock" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toMatch(/Incorrect password/),
  );
  expect(vault.locked).toBe(true);
  await user.type(screen.getByLabelText("Password"), "correct horse battery");
  await user.click(screen.getByRole("button", { name: "Unlock" }));
  await screen.findByRole("button", { name: "Copy: Example alice" });
  expect(vault.locked).toBe(false);
});
test("Escape cancels deletion while keeping the account and current screen", async () => {
  const user = userEvent.setup();
  const vault = await openApp();
  await act(() =>
    vault.importText(
      "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example",
    ),
  );
  await user.click(
    screen.getByRole("button", { name: "Settings: Example alice" }),
  );
  await user.click(screen.getByRole("button", { name: "Delete" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(vault.accounts).toHaveLength(1);
  expect(
    screen.getByRole("button", { name: "Copy: Example alice" }),
  ).toBeTruthy();
});
test("sync setup requires a screen password before it can connect", async () => {
  const user = userEvent.setup();
  const vault = await openApp();
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("button", { name: /Browser sync/ }));
  expect(screen.getByText("Set a password first")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Turn on sync" })).toBeNull();
  expect(vault.syncEnabled).toBe(false);
});

test("wiping a vault requires the explicit confirmation text and Escape preserves its accounts", async () => {
  const user = userEvent.setup();
  const vault = await openApp();
  await act(() =>
    vault.importText(
      "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example",
    ),
  );
  await user.click(screen.getByRole("button", { name: "Data" }));
  await user.click(screen.getByRole("button", { name: /Delete all data/ }));
  const dialog = screen.getByRole("dialog");
  expect(
    (
      within(dialog).getByRole("button", {
        name: "Delete",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(vault.accounts).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: /Delete all data/ }));
  await user.type(
    screen.getByLabelText("Type DELETE to remove all saved accounts."),
    "DELETE",
  );
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }),
  );
  await waitFor(() => expect(vault.accounts).toHaveLength(0));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("status").textContent).toBe("All local data has been cleared.");
});

test.each(["delete confirmation", "drag preview"] as const)(
  "locking unmounts the sensitive account subtree during %s",
  async (state) => {
    const user = userEvent.setup();
    const vault = await openApp();
    await act(async () => {
      await vault.importText(
        "otpauth://totp/PrivateService:private-user?secret=JBSWY3DPEHPK3PXP&issuer=PrivateService",
      );
      await vault.changePassword("", "correct horse battery");
      await vault.updateSettings({ accountSortMode: "manual" });
    });
    if (state === "delete confirmation") {
      await user.click(
        screen.getByRole("button", {
          name: "Settings: PrivateService private-user",
        }),
      );
      await user.click(screen.getByRole("button", { name: "Delete" }));
      expect(screen.getByRole("dialog")).toBeTruthy();
    } else {
      vi.stubGlobal("PointerEvent", MouseEvent);
      const handle = screen.getByRole("button", {
        name: "Drag to reorder: PrivateService",
      });
      handle.setPointerCapture = vi.fn();
      fireEvent.pointerDown(handle, { button: 0, pointerId: 1 });
      expect(document.querySelector(".account-row.dragging")).not.toBeNull();
    }
    await act(() => vault.lock());
    expect(screen.getByRole("heading", { name: "Locked" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("[data-account-id]")).toBeNull();
    expect(document.body.textContent).not.toContain("PrivateService");
    expect(document.body.textContent).not.toContain("private-user");
    await act(() => vault.unlock("correct horse battery"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".account-row.dragging")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Copy: PrivateService private-user" }),
    ).toBeTruthy();
  },
);

test("header logo counts down only while time-based accounts exist", async () => {
  const clock = vi
    .spyOn(Date, "now")
    .mockReturnValue(new Date("2026-11-07T00:00:10Z").getTime());
  try {
    const vault = await openApp();
    const ring = () =>
      Array.from(
        document.querySelectorAll(".brand-logo circle[stroke-dasharray]"),
      ).map((circle) => circle.getAttribute("stroke-dasharray"));
    const complete = Array(4).fill("31.17 135.09");
    expect(ring()).toEqual(complete);
    await act(() =>
      vault.importText(
        "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example",
      ),
    );
    await waitFor(() => expect(ring()).not.toEqual(complete));
    clock.mockReturnValue(new Date("2026-11-07T00:00:55Z").getTime());
    await act(() => vault.refreshCodes());
    expect(vault.codes[vault.accounts[0].id].remaining).toBe(5);
    expect(
      Array.from(
        document.querySelectorAll(".brand-logo circle[stroke-dasharray]"),
      ).every((arc) => arc.getAttribute("stroke") === "#EA4335"),
    ).toBe(true);
    clock.mockReturnValue(new Date("2026-11-07T00:01:00Z").getTime());
    await act(() => vault.refreshCodes());
    expect(ring()).toEqual(complete);

    await act(() => vault.deleteAccount(vault.accounts[0]));
    expect(ring()).toEqual(complete);
    await act(() =>
      vault.importText(
        "otpauth://hotp/Example:bob?secret=JBSWY3DPEHPK3PXP&issuer=Example&counter=0",
      ),
    );
    expect(vault.accounts).toHaveLength(1);
    expect(ring()).toEqual(complete);
  } finally {
    clock.mockRestore();
  }
});

test("default add uses screenshot and a single-character UI password survives locking", async () => {
  const user = userEvent.setup();
  const vault = await openApp();
  await user.click(screen.getByRole("button", { name: "Add account" }));
  expect(
    screen
      .getByRole("button", { name: "Screenshot" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  await user.click(screen.getByRole("button", { name: "Manual entry" }));
  expect(
    screen.getByLabelText("Name (site or service)").getAttribute("type"),
  ).toBe("text");
  expect(screen.getByRole("group", { name: "Type" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("button", { name: /UI password/ }));
  await user.type(screen.getByLabelText("New password"), "1");
  await user.type(screen.getByLabelText("Confirm password"), "1");
  await user.click(screen.getByRole("button", { name: "Save password" }));
  await waitFor(() => expect(vault.passwordProtected).toBe(true));
  await act(() => vault.lock());
  await user.type(screen.getByLabelText("Password"), "1");
  await user.click(screen.getByRole("button", { name: "Unlock" }));
  await waitFor(() => expect(vault.locked).toBe(false));
});

test.each([false, true])(
  "passkey instructions match password protection: %s",
  async (protectedVault) => {
    const user = userEvent.setup();
    const vault = await openApp();
    if (protectedVault) await act(() => vault.changePassword("", "a"));
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(
      screen.getByRole("button", { name: /Passkey & shortcuts/ }),
    );
    expect(screen.queryByText(/Touch ID/)).toBeNull();
    expect(screen.queryByText(/skip password/)).toBeNull();
    expect(screen.queryByText(/Shift\+8/)).toBeNull();
    expect(screen.queryByText(/WebAuthn PRF/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    if (protectedVault) {
      expect(
        screen.getByText("Unlock with a passkey or your password."),
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Register" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Set password" })).toBeNull();
    } else {
      expect(screen.getByText("Set a password first")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Set password" }));
      expect(screen.getByLabelText("New password")).toBeTruthy();
      expect(screen.getByLabelText("Confirm password")).toBeTruthy();
    }
  },
);

test("export format buttons keep plaintext confirmation and export encrypted backups directly", async () => {
  const user = userEvent.setup();
  const vault = await openApp();
  await act(() =>
    vault.importText(
      "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example",
    ),
  );
  const download = vi
    .spyOn(backup, "downloadFile")
    .mockImplementation(() => {});
  try {
    await user.click(screen.getByRole("button", { name: "Data" }));
    const choices = screen.getByRole("group", { name: "Export format" });
    expect(within(choices).getAllByRole("button")).toHaveLength(3);
    const exportButton = screen.getByRole("button", { name: "Export backup" });
    expect((exportButton as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("Backup password"), "a");
    expect((exportButton as HTMLButtonElement).disabled).toBe(false);
    await user.click(within(choices).getByRole("button", { name: "JSON" }));
    expect(screen.queryByLabelText("Backup password")).toBeNull();
    await user.click(exportButton);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(download).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    await user.click(within(choices).getByRole("button", { name: "otpauth" }));
    await user.click(exportButton);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(download).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    await user.click(within(choices).getByRole("button", { name: ".2fa" }));
    expect(
      (screen.getByLabelText("Backup password") as HTMLInputElement).value,
    ).toBe("");
    await user.type(screen.getByLabelText("Backup password"), "a");
    await user.click(exportButton);
    await waitFor(() => expect(download).toHaveBeenCalledOnce());
    expect(download.mock.calls[0][0].filename).toMatch(/\.2fa$/);
    await waitFor(() => expect(vault.settings.lastBackupAt).toBeTruthy());
  } finally {
    download.mockRestore();
  }
});

test("appearance buttons persist the selected theme", async () => {
  const user = userEvent.setup();
  const vault = await openApp();
  await user.click(screen.getByRole("button", { name: "Settings" }));
  const choices = screen.getByRole("group", { name: "Appearance" });
  await user.click(within(choices).getByRole("button", { name: "Dark" }));
  await waitFor(() => expect(vault.settings.theme).toBe("dark"));
  expect(
    within(choices)
      .getByRole("button", { name: "Dark" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  await user.click(within(choices).getByRole("button", { name: "System" }));
  await waitFor(() => expect(vault.settings.theme).toBe("system"));
});

test("import panel separates file and paste workflows and preserves pasted input", async () => {
  const user = userEvent.setup();
  const vault = await openApp();
  await user.click(screen.getByRole("button", { name: "Data" }));
  expect(screen.getByRole("region", { name: "Import" })).toBeTruthy();
  expect(
    screen.queryByLabelText("Paste otpauth links or JSON backup"),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "Paste" }));
  const text = document.getElementById("import-text") as HTMLTextAreaElement;
  await user.type(
    text,
    "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example",
  );
  await user.click(screen.getByRole("button", { name: "File" }));
  expect(document.getElementById("import-text")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Paste" }));
  expect(
    (document.getElementById("import-text") as HTMLTextAreaElement).value,
  ).toContain("Example:alice");
  await user.click(
    within(screen.getByRole("region", { name: "Import" })).getByRole("button", {
      name: "Import",
    }),
  );
  await waitFor(() => expect(vault.accounts).toHaveLength(1));
});

test("saving an invalid account and password failures display the selected language", async () => {
  const user = userEvent.setup();
  const vault = await openApp();
  await act(() =>
    vault.updateSettings({ language: "zh", languageMode: "manual" }),
  );
  await user.click(screen.getByRole("button", { name: "添加账号" }));
  await user.click(screen.getByRole("button", { name: "手动添加" }));
  fireEvent.change(document.getElementById("account-label")!, {
    target: { value: "alice" },
  });
  fireEvent.change(document.getElementById("account-secret")!, {
    target: { value: "invalid!" },
  });
  fireEvent.submit(document.querySelector("form")!);
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      "请输入有效的 Base32 密钥，仅使用 A–Z 和 2–7。",
    ),
  );
  expect(vault.accounts).toHaveLength(0);
  await act(async () => {
    vault.error = "Current password is incorrect.";
  });
  expect(
    screen
      .getAllByRole("alert")
      .some((element) => element.textContent?.includes("密码不正确，请重试。")),
  ).toBe(true);
});

test("file import asks for the password of an encrypted backup inside its panel", async () => {
  const user = userEvent.setup();
  const { encryptedBackup } = await import("../../src/domain/sealing");
  const { validateCredential } = await import("../../src/domain/records");
  const contents = await encryptedBackup(
    {
      entries: [
        validateCredential({
          login: "backup-account",
          secret: "JBSWY3DPEHPK3PXP",
        }),
      ],
    },
    "x",
  );
  const file = new File([], "backup.2fa", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => contents });
  const vault = await openApp();
  await user.click(screen.getByRole("button", { name: "Data" }));
  fireEvent.change(document.querySelector("input[type=file]")!, {
    target: { files: [file] },
  });
  const panel = screen.getByRole("region", { name: "Import" });
  const password = await within(panel).findByLabelText(
    "Backup password (if the backup is encrypted)",
  );
  await user.type(password, "wrong");
  await user.click(within(panel).getByRole("button", { name: "Import" }));
  await waitFor(() =>
    expect(within(panel).getByRole("alert").textContent).toBe(
      "Incorrect backup password.",
    ),
  );
  expect(vault.accounts).toHaveLength(0);
  expect(document.querySelector(".confetti")).toBeNull();
  await user.clear(password);
  await user.type(password, "x");
  await user.click(within(panel).getByRole("button", { name: "Import" }));
  await waitFor(() => expect(vault.accounts[0]?.label).toBe("backup-account"));
  await waitFor(() => expect(document.querySelector(".confetti")).not.toBeNull());
});

test("page-scan retains the scanner, shows progress and a persistent result, and keeps imported accounts accessible", async () => {
  const listeners = new Set<(message: unknown) => void>();
  Object.assign(chrome.runtime, {
    onMessage: {
      addListener: (listener: (message: unknown) => void) =>
        listeners.add(listener),
      removeListener: (listener: (message: unknown) => void) =>
        listeners.delete(listener),
    },
  });
  const user = userEvent.setup();
  const vault = await openApp();
  // Storage may update the open vault before the completion message arrives.
  await act(() =>
    vault.importText(
      "otpauth://totp/Scanned:alice?secret=JBSWY3DPEHPK3PXP&issuer=Scanned",
    ),
  );
  fireEvent.change(document.querySelector(".search input")!, {
    target: { value: "no-match" },
  });
  await user.click(screen.getByRole("button", { name: "Add account" }));
  Object.assign(chrome.runtime, {
    sendMessage: (_message: unknown, callback: (response: unknown) => void) =>
      callback({ ok: true }),
  });
  const close = vi.spyOn(window, "close").mockImplementation(() => {});
  await user.click(screen.getByRole("button", { name: "Scan page" }));
  expect(document.querySelector(".scan-msg")?.textContent).toContain(
    "Recognizing",
  );
  await act(async () => {
    for (const listener of listeners)
      listener({
        type: "page-scan:completed",
        ok: true,
        imported: 1,
        message: "1 account imported.",
      });
  });
  await waitFor(() =>
    expect(document.querySelector(".scan-msg")?.textContent).toBe(
      "Authenticator accounts added: 1",
    ),
  );
  await waitFor(() => expect(document.querySelector(".confetti")).not.toBeNull());
  expect(
    screen.getByRole("button", { name: "Capture screen & detect" }),
  ).toBeTruthy();
  expect(close).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Codes" }));
  expect(
    screen.getByRole("button", { name: "Copy: Scanned alice" }),
  ).toBeTruthy();
  close.mockRestore();
  expect(
    (document.querySelector(".search input") as HTMLInputElement).value,
  ).toBe("");
  expect(document.querySelector(".toast")?.textContent).toBe(
    "Authenticator accounts added: 1",
  );
});

test.each([
  ["MacIntel", "⌘⇧2"],
  ["Win32", "Ctrl+Shift+2"],
  ["Linux x86_64", "Ctrl+Shift+2"],
])(
  "shortcut modifiers follow the current platform: %s",
  async (platform, shortcut) => {
    const original = Object.getOwnPropertyDescriptor(navigator, "platform");
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: platform,
    });
    try {
      const user = userEvent.setup();
      await openApp();
      await user.click(screen.getByRole("button", { name: "Settings" }));
      await user.click(
        screen.getByRole("button", { name: /Passkey & shortcuts/ }),
      );
      expect(screen.getByText(shortcut)).toBeTruthy();
      expect(screen.queryByText("⌘ / Ctrl + Shift + 2")).toBeNull();
    } finally {
      if (original) Object.defineProperty(navigator, "platform", original);
      else Reflect.deleteProperty(navigator, "platform");
    }
  },
);

test("sync setup keeps save-key confirmation and shows a readable, masked recovery key and account count", async () => {
  const user = userEvent.setup();
  const vault = await openApp();
  await act(async () => {
    await vault.importText(
      "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example",
    );
    await vault.changePassword("", "a");
  });
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("button", { name: /Browser sync/ }));
  await user.click(screen.getByRole("button", { name: /Set up sync/ }));
  const key = (screen.getByLabelText("Recovery key") as HTMLTextAreaElement)
    .value;
  expect(screen.getByText("Save your recovery key").closest("form")).toBeNull();
  expect(
    (screen.getByLabelText("Recovery key") as HTMLTextAreaElement).rows,
  ).toBe(2);
  await user.click(screen.getByLabelText("Recovery key"));
  expect(await navigator.clipboard.readText()).toBe(key);
  expect(
    (screen.getByRole("button", { name: "Turn on sync" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await user.click(
    screen.getByRole("checkbox", {
      name: "I have saved my recovery key somewhere safe.",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Turn on sync" }));
  await waitFor(() => expect(vault.syncEnabled).toBe(true));
  expect((screen.getByLabelText("Recovery key") as HTMLInputElement).type).toBe(
    "password",
  );
  expect(screen.getByText("Accounts: 1")).toBeTruthy();
  expect(screen.getByText("Recovery key").closest(".sync-panel")).toBeNull();
  await user.click(screen.getByLabelText("Recovery key"));
  expect(await navigator.clipboard.readText()).toBe(key);
  await user.click(screen.getByRole("button", { name: "Show recovery key" }));
  expect(screen.getByLabelText("Recovery key").tagName).toBe("TEXTAREA");
  expect(
    (screen.getByLabelText("Recovery key") as HTMLTextAreaElement).rows,
  ).toBe(2);
  await navigator.clipboard.writeText("");
  fireEvent.keyDown(screen.getByLabelText("Recovery key"), { key: "Enter" });
  await waitFor(async () =>
    expect(await navigator.clipboard.readText()).toBe(key),
  );
  expect(
    (screen.getByLabelText("Recovery key") as HTMLTextAreaElement).value,
  ).toBe(key);
  await user.click(screen.getByRole("button", { name: "Hide recovery key" }));
  expect((screen.getByLabelText("Recovery key") as HTMLInputElement).type).toBe(
    "password",
  );
  await act(() =>
    vault.updateSettings({ language: "zh", languageMode: "manual" }),
  );
  expect(screen.getByText("1 个账号")).toBeTruthy();
});

test("remove-password dialog labels the current password once and Escape preserves protection", async () => {
  const user = userEvent.setup();
  const vault = await openApp();
  await act(() => vault.changePassword("", "a"));
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("button", { name: /UI password/ }));
  await user.click(screen.getByRole("button", { name: "Remove password" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getAllByText("Current password")).toHaveLength(1);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(vault.passwordProtected).toBe(true);
});

test("successful passkey registration replaces Register with confirmed deletion; cancellation preserves it", async () => {
  const original = Object.getOwnPropertyDescriptor(navigator, "credentials");
  Object.defineProperty(navigator, "credentials", {
    configurable: true,
    value: {
      create: vi.fn().mockResolvedValue({
        rawId: new Uint8Array([1, 2, 3]).buffer,
        getClientExtensionResults: () => ({
          prf: { results: { first: new Uint8Array(32).fill(7).buffer } },
        }),
      }),
    },
  });
  try {
    const user = userEvent.setup();
    const vault = await openApp();
    await act(() => vault.changePassword("", "a"));
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(
      screen.getByRole("button", { name: /Passkey & shortcuts/ }),
    );
    await user.click(screen.getByRole("button", { name: "Register" }));
    await screen.findByRole("button", { name: "Delete" });
    expect(screen.queryByRole("button", { name: "Register" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete",
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Register" })).toBeTruthy();
    expect(vault.passwordProtected).toBe(true);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(
      screen.getByRole("button", { name: /Passkey & shortcuts/ }),
    );
    expect(screen.getByText("No passkey registered yet")).toBeTruthy();
  } finally {
    if (original) Object.defineProperty(navigator, "credentials", original);
    else Reflect.deleteProperty(navigator, "credentials");
  }
});

test("joining sync keeps the key editable and the title outside the card", async () => {
  const user = userEvent.setup();
  const vault = await openApp();
  await act(() => vault.changePassword("", "a"));
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("button", { name: /Browser sync/ }));
  await user.click(
    screen.getByRole("button", { name: /Connect to existing sync/ }),
  );
  expect(screen.getByText("Connect this device").closest("form")).toBeNull();
  const key = screen.getByLabelText("Recovery key") as HTMLTextAreaElement;
  expect(key.rows).toBe(2);
  expect(key.readOnly).toBe(false);
  await navigator.clipboard.writeText("unchanged");
  await user.type(key, "A2FA1-test");
  expect(key.value).toBe("A2FA1-test");
  expect(await navigator.clipboard.readText()).toBe("unchanged");
});

test("remove-password failures stay in the dialog and disappear after cancelling", async () => {
  const user = userEvent.setup();
  const vault = await openApp();
  await act(() => vault.changePassword("", "a"));
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("button", { name: /UI password/ }));
  await user.click(screen.getByRole("button", { name: "Remove password" }));
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByLabelText("Current password"), "wrong");
  await user.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() =>
    expect(within(dialog).getByRole("alert").textContent).toBe(
      t("en", "passwordIncorrect"),
    ),
  );
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(vault.passwordProtected).toBe(true);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(vault.error).toBe("");
  await user.click(screen.getByRole("button", { name: "Remove password" }));
  expect(within(screen.getByRole("dialog")).queryByRole("alert")).toBeNull();
});

test("locked passkey button and failed unlocks use the selected language in a persistent feedback area", async () => {
  const user = userEvent.setup();
  const vault = await openApp();
  await act(async () => {
    await vault.changePassword("", "a");
    await vault.updateSettings({ language: "zh", languageMode: "manual" });
    await vault.lock();
  });
  const feedback = document.querySelector(".lock-feedback");
  expect(feedback).toBeTruthy();
  expect(feedback?.textContent).toBe("");
  const lock = document.querySelector(".lock-screen") as HTMLElement;
  expect(within(lock).getByRole("button", { name: "通行密钥" })).toBeTruthy();
  await user.type(within(lock).getByLabelText("密码"), "wrong");
  fireEvent.submit(document.querySelector(".lock-form") as HTMLFormElement);
  await waitFor(() =>
    expect(within(lock).getByRole("alert").textContent).toBe(
      t("zh", "passwordIncorrect"),
    ),
  );
  expect(document.querySelector(".lock-feedback")).toBe(feedback);
  await user.click(within(lock).getByRole("button", { name: "通行密钥" }));
  await waitFor(() =>
    expect(within(lock).getByRole("alert").textContent).toBe(
      t("zh", "passkeyFailed"),
    ),
  );
  expect(vault.locked).toBe(true);
});

test("manual sync runs the real sync action, shows progress, then confirms local completion", async () => {
  const device = createBrowserSyncNetwork().createDevice();
  device.install();
  const user = userEvent.setup();
  const vault = await openApp();
  await act(async () => {
    await vault.changePassword("", "a");
    await vault.startBrowserSync(generateSyncRecoveryKey(), false);
    vault.notice = "";
  });
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("button", { name: /Browser sync/ }));
  const sync = vault.syncNow.bind(vault);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const called = vi.spyOn(vault, "syncNow").mockImplementationOnce(async () => {
    await gate;
    await sync();
  });
  try {
    await user.click(screen.getByRole("button", { name: "Sync now" }));
    expect(called).toHaveBeenCalledOnce();
    expect(
      (screen.getByRole("button", { name: "Syncing…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(vault.notice).toBe("");
    await act(async () => {
      release();
      await called.mock.results[0].value;
    });
    await waitFor(() => expect(vault.notice).toBe(t("en", "syncReady")));
    expect(vault.syncStatus).toBe("ready");
    expect(screen.getByRole("button", { name: "Sync now" })).toBeTruthy();
    act(() => {
      vault.notice = "";
    });
    device.sync.readError = "quota";
    await user.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(t("en", "syncQuota")),
    );
    expect(vault.notice).toBe("");
  } finally {
    release();
    called.mockRestore();
  }
});

test.each(["manual lock", "reopen"] as const)(
  "password automatically focuses on the unlock screen after %s",
  async (mode) => {
    const user = userEvent.setup();
    let vault = await openApp();
    await act(async () => {
      await vault.changePassword("", "a");
      await vault.lock();
    });
    if (mode === "reopen") {
      cleanup();
      vault = new AuthenticatorVault();
      render(<App vault={vault} />);
    }
    await waitFor(() =>
      expect(screen.getByLabelText("Password").hasAttribute("disabled")).toBe(false),
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Password"));
    await user.keyboard("a{Enter}");
    await waitFor(() => expect(vault.locked).toBe(false));
    await user.click(screen.getByRole("button", { name: "Lock" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("Password")),
    );
  },
);

test("account filter and navigation keep their meanings after switching Chinese and French", async () => {
  const vault = await openApp();
  await act(() =>
    vault.updateSettings({ language: "zh", languageMode: "manual" }),
  );
  expect(document.querySelector(".chips")?.getAttribute("aria-label")).toBe(
    "账号",
  );
  expect(screen.getByRole("button", { name: "验证码" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "常用" })).toBeTruthy();
  await act(() =>
    vault.updateSettings({ language: "fr", languageMode: "manual" }),
  );
  expect(document.querySelector(".chips")?.getAttribute("aria-label")).toBe(
    "Comptes",
  );
  expect(screen.getByRole("button", { name: "Codes" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Favoris" })).toBeTruthy();
});

test("the input menu defaults on, asks for website access only on demand, and remembers turning it off", async () => {
  const user = userEvent.setup();
  const request = vi.fn<() => Promise<boolean>>()
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);
  Object.assign(chrome, {
    permissions: { contains: vi.fn(async () => false), request },
  });
  const vault = await openApp();
  await user.click(screen.getByRole("button", { name: "Settings" }));
  const toggle = screen.getByRole<HTMLInputElement>("switch", {
    name: "Page input enhancement menu",
  });
  const allow = await screen.findByRole("button", { name: "Allow website access" });
  expect(toggle.checked).toBe(true);
  expect(request).not.toHaveBeenCalled();
  await user.click(allow);
  expect(request).toHaveBeenCalledWith({ origins: ["http://*/*", "https://*/*"] });
  expect(screen.getByRole("button", { name: "Allow website access" })).toBeTruthy();
  await user.click(allow);
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Allow website access" })).toBeNull(),
  );
  await user.click(toggle);
  await waitFor(() => expect(vault.settings.enhancedInputMenu).toBe(false));
  const reopened = new AuthenticatorVault();
  await reopened.initialize();
  expect(reopened.settings.enhancedInputMenu).toBe(false);
});

test("auto-lock prompts for an interface password before offering durations", async () => {
  const user = userEvent.setup();
  const vault = await openApp();
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("button", { name: "Auto-lock" }));
  expect((await screen.findByRole("status")).textContent).toBe("Set a password first");
  expect(screen.queryByRole("group", { name: "Auto-lock" })).toBeNull();
  await act(() => vault.changePassword("", "1"));
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("button", { name: "Auto-lock" }));
  expect(await screen.findByRole("button", { name: "Never" })).toBeTruthy();
});

test("auto-lock filters by unit without saving until a duration is selected, and reopens at the saved unit", async () => {
  const user = userEvent.setup();
  const vault = await openApp();
  await act(async () => {
    await vault.changePassword("", "1");
    await vault.updateSettings({ autoLockMinutes: 10080 });
  });
  await user.click(screen.getByRole("button", { name: "Settings" }));
  const toggle = screen.getByRole("button", { name: "Auto-lock" });
  expect(toggle.textContent).toBe("7 days");
  await user.click(toggle);
  expect(
    screen.getByRole("button", { name: "days" }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.getByRole("button", { name: "30 days" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "5 minutes" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "minutes" }));
  expect(vault.settings.autoLockMinutes).toBe(10080);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(screen.queryByRole("button", { name: "30 days" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "5 minutes" }));
  await waitFor(() => expect(vault.settings.autoLockMinutes).toBe(5));
  await user.click(toggle);
  expect(
    screen
      .getByRole("button", { name: "minutes" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.queryByRole("button", { name: "seconds" })).toBeNull();
  expect(screen.queryByRole("button", { name: "30 seconds" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Never" }));
  await waitFor(() => expect(vault.settings.autoLockMinutes).toBe(-1));
});


test("clearing data retains the action language for its success toast after preferences reset", async () => {
  const user = userEvent.setup();
  const vault = await openApp();
  await user.click(screen.getByRole("button", { name: "Data" }));
  await act(() => vault.updateSettings({ language: "zh", languageMode: "manual" }));
  await user.click(screen.getByRole("button", { name: /清除全部数据/ }));
  await user.type(document.getElementById("delete-confirmation")!, "DELETE");
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "删除" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(vault.settings.language).toBe("en");
  expect(screen.getByRole("status").textContent).toBe("本机数据已全部清除。");
});

test("failed data clearing preserves accounts and reports failure in the confirmation dialog", async () => {
  const user = userEvent.setup();
  const vault = await openApp();
  await act(() => vault.addAccount({ label: "Keep", secret: "JBSWY3DPEHPK3PXP" }));
  await user.click(screen.getByRole("button", { name: "Data" }));
  await user.click(screen.getByRole("button", { name: /Delete all data/ }));
  await user.type(document.getElementById("delete-confirmation")!, "DELETE");
  const write = vi.spyOn(chrome.storage.local, "set").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  try {
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toBe(t("en", "actionFailed")));
    expect(vault.accounts).toHaveLength(1);
    expect(screen.queryByRole("status")).toBeNull();
    const reopened = new AuthenticatorVault();
    await reopened.initialize();
    expect(reopened.accounts[0].label).toBe("Keep");
  } finally {
    write.mockRestore();
  }
});
