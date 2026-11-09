// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AuthenticatorVault } from "../../src/platform/controller";
import { VaultProvider } from "../../src/app/vault";
import { AccountForm } from "../../src/features/accounts/AccountForm";
import { accountToOtpAuthUri, parseTransfer } from "../../src/domain/transfer";
import { installStructuredCloneChromeStorage } from "../helpers/storage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
test.each(["TOTP", "HOTP"])(
  "every offered %s digit count saves and survives URI export/import",
  async (mode) => {
    installStructuredCloneChromeStorage();
    const vault = new AuthenticatorVault();
    await vault.initialize();
    const saved = vi.fn();
    render(
      <VaultProvider vault={vault}>
        <AccountForm onSaved={saved} />
      </VaultProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: mode === "TOTP" ? "Time-based" : "Counter-based",
      }),
    );
    fireEvent.change(document.getElementById("account-secret")!, {
      target: { value: "JBSWY3DPEHPK3PXP" },
    });
    const toggle = document.querySelector<HTMLButtonElement>(".dd-btn")!;
    fireEvent.click(toggle);
    const offered = [
      ...document.querySelectorAll<HTMLButtonElement>(".dd-menu button"),
    ].map((button) => button.textContent!);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(offered.length).toBeGreaterThan(0);
    for (const [index, digits] of offered.entries()) {
      fireEvent.change(document.getElementById("account-label")!, {
        target: { value: `alice-${digits}` },
      });
      fireEvent.click(toggle);
      fireEvent.click(screen.getByRole("button", { name: digits }));
      fireEvent.click(screen.getByRole("button", { name: "Save account" }));
      await waitFor(() => expect(saved).toHaveBeenCalledTimes(index + 1));
      const account = vault.accounts.find(
        (x) => x.label === `alice-${digits}`,
      )!;
      expect(account.digits).toBe(Number(digits));
      expect(vault.codes[account.id]?.value).toHaveLength(Number(digits));
      const [copy] = await parseTransfer(accountToOtpAuthUri(account));
      expect(copy?.digits).toBe(account.digits);
    }
  },
);
test("an edited Steam account can switch to numeric OTP with a valid default digit count", async () => {
  installStructuredCloneChromeStorage();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  const account = await vault.addAccount({
    label: "steam-user",
    secret: "JBSWY3DPEHPK3PXP",
    type: "steam",
  });
  const saved = vi.fn();
  render(
    <VaultProvider vault={vault}>
      <AccountForm initial={account} onSaved={saved} />
    </VaultProvider>,
  );
  expect(document.querySelector<HTMLButtonElement>(".dd-btn")?.disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "Time-based" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(vault.accounts[0]).toMatchObject({ type: "totp", digits: 6 });
});
