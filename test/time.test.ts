import { beforeEach, afterEach, expect, test, vi } from "vitest";
import {
  calibrateGoogleTime,
  readTimeCalibration,
  otpTime,
  TIME_CALIBRATION_KEY,
} from "../src/platform/time";
import {
  installMemoryStorage,
  installStructuredCloneChromeStorage,
} from "./helpers/storage";
import { AuthenticatorVault } from "../src/platform/controller";
import { codeFor } from "../src/domain/otp";
import { toCredential } from "../src/domain/view";
const server = Date.UTC(2026, 10, 9);
const local = server - 60000;
function reply(headers: Record<string, string> = {}) {
  return new Response(null, {
    status: 204,
    headers: { Date: new Date(server).toUTCString(), ...headers },
  });
}
beforeEach(() => {
  installMemoryStorage();
  vi.spyOn(Date, "now").mockReturnValue(local);
  let tick = 0;
  vi.spyOn(performance, "now").mockImplementation(() => tick++ * 100);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => reply()),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
test("calibration compensates latency and persists a device-local correction", async () => {
  const value = await calibrateGoogleTime();
  expect(value.offsetMs).toBe(60450);
  expect(await otpTime()).toBe(local + 60450);
  expect(await readTimeCalibration()).toEqual(value);
  expect(fetch).toHaveBeenCalledTimes(3);
  const [url, options] = vi.mocked(fetch).mock.calls[0]!;
  expect(
    new URL(
      typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
    ).origin,
  ).toBe("https://www.google.com");
  expect(
    new URL(
      typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
    ).pathname,
  ).toBe("/generate_204");
  expect(options).toMatchObject({
    method: "HEAD",
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
  });
});
test("requests only Google host permission before any network access", async () => {
  installStructuredCloneChromeStorage();
  const request = vi.fn(async () => false);
  Object.assign(chrome, { permissions: { request } });
  const pending = calibrateGoogleTime();
  expect(request).toHaveBeenCalledWith({
    origins: ["https://www.google.com/*"],
  });
  await expect(pending).rejects.toMatchObject({ code: "permission" });
  expect(fetch).not.toHaveBeenCalled();
  expect(await readTimeCalibration()).toBeNull();
});
test("correction is shared through extension storage, not the workspace document", async () => {
  installStructuredCloneChromeStorage();
  Object.assign(chrome, { permissions: { request: vi.fn(async () => true) } });
  await calibrateGoogleTime();
  expect(await readTimeCalibration()).toMatchObject({ offsetMs: 60450 });
  const stored = await new Promise<Record<string, unknown>>((resolve) =>
    chrome.storage.local.get<Record<string, unknown>>(
      TIME_CALIBRATION_KEY,
      (items) => resolve(items),
    ),
  );
  expect(stored[TIME_CALIBRATION_KEY]).toMatchObject({ offsetMs: 60450 });
});
test.each<Record<string, string>>([
  { Date: "invalid" },
  { Date: "" },
  { Age: "30" },
])("rejects unusable or cached server headers %j", async (headers) => {
  vi.mocked(fetch).mockResolvedValue(reply(headers));
  await expect(calibrateGoogleTime()).rejects.toBeInstanceOf(Error);
  expect(await readTimeCalibration()).toBeNull();
});
test("a failed recalibration preserves the prior usable correction", async () => {
  const previous = await calibrateGoogleTime();
  vi.mocked(fetch).mockRejectedValue(new TypeError("offline"));
  await expect(calibrateGoogleTime()).rejects.toBeInstanceOf(Error);
  expect(await readTimeCalibration()).toEqual(previous);
});
test("selects the fastest valid sample and rejects excessive latency", async () => {
  const timings = [0, 1000, 1000, 1100, 1100, 1500];
  vi.spyOn(performance, "now").mockImplementation(() => timings.shift()!);
  expect((await calibrateGoogleTime()).offsetMs).toBe(60450);
  let tick = 0;
  vi.spyOn(performance, "now").mockImplementation(() => tick++ * 3000);
  await expect(calibrateGoogleTime()).rejects.toBeInstanceOf(Error);
});
test("ignores corrupted saved corrections", async () => {
  localStorage.setItem(
    TIME_CALIBRATION_KEY,
    JSON.stringify({ offsetMs: "bad", calibratedAt: 1 }),
  );
  expect(await readTimeCalibration()).toBeNull();
  expect(await otpTime()).toBe(local);
});
test("the real controller uses calibrated OTP time and countdown without changing the system clock", async () => {
  await calibrateGoogleTime();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  await vault.addAccount({ label: "alice", secret: "JBSWY3DPEHPK3PXP" });
  const item = vault.accounts[0]!;
  expect(vault.codes[item.id]?.value).toBe(
    await codeFor(toCredential(item), server + 450),
  );
  expect(vault.codes[item.id]?.remaining).toBe(30);
  expect(Date.now()).toBe(local);
});

test("unresponsive requests are aborted and preserve the last correction", async () => {
  const previous = await calibrateGoogleTime();
  vi.useFakeTimers();
  vi.mocked(fetch).mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options!.signal!.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
      }),
  );
  const pending = expect(calibrateGoogleTime()).rejects.toMatchObject({
    code: "network",
  });
  await vi.advanceTimersByTimeAsync(24000);
  await pending;
  expect(await readTimeCalibration()).toEqual(previous);
});
test("a failed storage write does not claim success or discard prior calibration", async () => {
  const previous = await calibrateGoogleTime();
  vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  await expect(calibrateGoogleTime()).rejects.toMatchObject({
    code: "storage",
  });
  expect(await readTimeCalibration()).toEqual(previous);
});
