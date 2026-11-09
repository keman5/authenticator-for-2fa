// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../src/app/App";
import { SettingsView } from "../../src/features/settings/SettingsView";
import { VaultProvider } from "../../src/app/vault";
import { AuthenticatorVault } from "../../src/platform/controller";
import { installStructuredCloneChromeStorage } from "../helpers/storage";
import * as time from "../../src/platform/time";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
test("the settings action calibrates, disables repeated clicks and immediately refreshes codes", async () => {
  installStructuredCloneChromeStorage();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  let finish!: (value: time.TimeCalibration) => void;
  const calibrate = vi.spyOn(time, "calibrateGoogleTime").mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  vi.spyOn(time, "readTimeCalibration").mockResolvedValue(null);
  const refresh = vi.spyOn(vault, "refreshCodes").mockResolvedValue();
  render(
    <VaultProvider vault={vault}>
      <SettingsView onNavigate={() => {}} />
    </VaultProvider>,
  );
  const button = screen.getByRole("button", {
    name: "Calibrate time with Google",
  });
  fireEvent.click(button);
  expect(calibrate).toHaveBeenCalledTimes(1);
  expect((button as HTMLButtonElement).disabled).toBe(true);
  finish({ offsetMs: 60000, calibratedAt: Date.now() });
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect((await screen.findByRole("status")).textContent).toContain("60");
  expect((button as HTMLButtonElement).disabled).toBe(false);
});
test("a permission failure gives clear feedback without changing codes", async () => {
  installStructuredCloneChromeStorage();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  vi.spyOn(time, "readTimeCalibration").mockResolvedValue(null);
  vi.spyOn(time, "calibrateGoogleTime").mockRejectedValue({
    code: "permission",
  });
  const refresh = vi.spyOn(vault, "refreshCodes");
  render(
    <VaultProvider vault={vault}>
      <SettingsView onNavigate={() => {}} />
    </VaultProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Calibrate time with Google" }),
  );
  expect((await screen.findByRole("alert")).textContent).toMatch(/permission/i);
  expect(refresh).not.toHaveBeenCalled();
});

async function openSettings() {
  installStructuredCloneChromeStorage();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  await vault.updateSettings({ language: "en", languageMode: "manual" });
  const user = userEvent.setup();
  render(<App vault={vault} />);
  await screen.findByRole("button", { name: "All0" });
  await user.click(screen.getByRole("button", { name: "Settings" }));
  return user;
}

async function saveCorrection(value: time.TimeCalibration) {
  await new Promise<void>((resolve) =>
    chrome.storage.local.set({ [time.TIME_CALIBRATION_KEY]: value }, resolve),
  );
}

test.each(["Codes", "Data"])(
  "leaving settings via %s clears calibration feedback without discarding the saved correction",
  async (destination) => {
    const user = await openSettings();
    const correction = { offsetMs: 60000, calibratedAt: Date.now() };
    vi.spyOn(time, "calibrateGoogleTime").mockImplementation(async () => {
      await saveCorrection(correction);
      return correction;
    });
    await user.click(
      screen.getByRole("button", { name: "Calibrate time with Google" }),
    );
    const message = "Applied correction: +60 seconds.";
    await screen.findByText(message);
    await user.click(screen.getByRole("button", { name: destination }));
    expect(screen.queryByText(message)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await act(async () => {});
    expect(screen.queryByText(message)).toBeNull();
    expect(await time.readTimeCalibration()).toEqual(correction);
  },
);

test.each(["permission", "network"])(
  "navigation clears a %s calibration error before returning to settings",
  async (code) => {
    const user = await openSettings();
    vi.spyOn(time, "calibrateGoogleTime").mockRejectedValue({ code });
    await user.click(
      screen.getByRole("button", { name: "Calibrate time with Google" }),
    );
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Codes" }));
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.queryByRole("alert")).toBeNull();
  },
);

test("a calibration finishing after navigation does not restore feedback on the next settings visit", async () => {
  const user = await openSettings();
  let finish!: (value: time.TimeCalibration) => void;
  vi.spyOn(time, "calibrateGoogleTime").mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await user.click(
    screen.getByRole("button", { name: "Calibrate time with Google" }),
  );
  await user.click(screen.getByRole("button", { name: "Data" }));
  const correction = { offsetMs: 60000, calibratedAt: Date.now() };
  await act(async () => {
    await saveCorrection(correction);
    finish(correction);
  });
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await act(async () => {});
  expect(screen.queryByText("Applied correction: +60 seconds.")).toBeNull();
  expect(await time.readTimeCalibration()).toEqual(correction);
});
