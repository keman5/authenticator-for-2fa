// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../src/app/App";
import * as qr from "../../src/domain/qr";
import { AuthenticatorVault } from "../../src/platform/controller";
import { installStructuredCloneChromeStorage } from "../helpers/storage";

beforeEach(() => {
  installStructuredCloneChromeStorage();
  localStorage.clear();
  sessionStorage.clear();
  // Canvas rendering is outside this test; retain the URI in the generated image URL.
  vi.spyOn(qr, "renderQrDataUrl").mockImplementation(
    async (uri) => `data:image/png;base64,${btoa(uri)}`,
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const original = {
  issuer: "Example",
  label: "alice",
  secret: "JBSWY3DPEHPK3PXP",
};
const newSecret = "KRSXG5DSMFWHK3DM";
async function openAccounts(labels = ["alice"]) {
  const a = new AuthenticatorVault();
  await a.initialize();
  for (const label of labels) await a.addAccount({ ...original, label });
  render(<App vault={a} />);
  await screen.findByRole("button", { name: "Settings: Example alice" });
  const b = new AuthenticatorVault();
  await b.initialize();
  return { a, b, user: userEvent.setup() };
}
test("QR image and copied URI follow a secret changed in another window", async () => {
  const { a, b, user } = await openAccounts();
  await user.click(
    screen.getByRole("button", { name: "Settings: Example alice" }),
  );
  await user.click(screen.getByRole("button", { name: "Show QR code" }));
  await screen.findByRole("img", { name: "QR code" });
  await act(() => b.updateAccount(b.accounts[0], { secret: newSecret }));
  await waitFor(() => expect(a.accounts[0].secret).toBe(newSecret));
  await user.click(screen.getByRole("button", { name: "Copy otpauth link" }));
  const uri = await navigator.clipboard.readText();
  expect(uri).toContain(newSecret);
  expect(uri).not.toContain(original.secret);
  await waitFor(() =>
    expect(
      screen.getByRole("img", { name: "QR code" }).getAttribute("src"),
    ).toBe(`data:image/png;base64,${btoa(uri)}`),
  );
});
test("deleting the account displayed in a QR page closes that page", async () => {
  const { a, b, user } = await openAccounts(["alice", "bob"]);
  await user.click(
    screen.getByRole("button", { name: "Settings: Example alice" }),
  );
  await user.click(screen.getByRole("button", { name: "Show QR code" }));
  await act(() => b.deleteAccount(b.accounts[0]));
  await waitFor(() => expect(a.accounts).toHaveLength(1));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Copy otpauth link" }),
    ).toBeNull(),
  );
  expect(
    screen.getByRole("button", { name: "Settings: Example bob" }),
  ).toBeTruthy();
});
test.each(["alice", "bob"])(
  "batch QR navigation remains valid after deleting %s",
  async (removedLabel) => {
    const { b, user } = await openAccounts(["alice", "bob"]);
    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(
      screen.getByRole("button", { name: "Bulk migration QR codes" }),
    );
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(document.querySelector(".uri-box")?.textContent).toContain("bob");
    await act(() =>
      b.deleteAccount(
        b.accounts.find((account) => account.label === removedLabel)!,
      ),
    );
    await waitFor(() =>
      expect(document.querySelector(".uri-box")?.textContent).toContain(
        removedLabel === "bob" ? "alice" : "bob",
      ),
    );
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  },
);
