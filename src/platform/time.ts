/** Device-local OTP correction; never included in account exports or cloud sync. */
export const TIME_CALIBRATION_KEY = "keman5.authenticator.time.v1";
export interface TimeCalibration {
  offsetMs: number;
  calibratedAt: number;
}
export class TimeCalibrationError extends Error {
  constructor(
    public readonly code: "permission" | "network" | "invalid" | "storage",
  ) {
    super(`Time calibration failed: ${code}`);
  }
}
function valid(value: unknown): value is TimeCalibration {
  if (!value || typeof value !== "object") return false;
  const item = value as TimeCalibration;
  return (
    Number.isSafeInteger(item.offsetMs) &&
    Number.isSafeInteger(item.calibratedAt) &&
    item.calibratedAt > 0 &&
    Number.isSafeInteger(Date.now() + item.offsetMs) &&
    Date.now() + item.offsetMs > 0
  );
}
export async function readTimeCalibration(): Promise<TimeCalibration | null> {
  try {
    const value: unknown =
      typeof chrome !== "undefined" && chrome.storage?.local
        ? await new Promise<unknown>((resolve, reject) => {
            chrome.storage.local.get(TIME_CALIBRATION_KEY, (items) => {
              if (chrome.runtime.lastError)
                reject(new TimeCalibrationError("storage"));
              else resolve(items[TIME_CALIBRATION_KEY]);
            });
          })
        : JSON.parse(localStorage.getItem(TIME_CALIBRATION_KEY) ?? "null");
    return valid(value) ? value : null;
  } catch {
    return null;
  }
}
export async function otpTime(): Promise<number> {
  const correction = await readTimeCalibration();
  return Date.now() + (correction?.offsetMs ?? 0);
}
async function save(value: TimeCalibration): Promise<void> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await new Promise<void>((resolve, reject) => {
        chrome.storage.local.set({ [TIME_CALIBRATION_KEY]: value }, () => {
          if (chrome.runtime.lastError)
            reject(new TimeCalibrationError("storage"));
          else resolve();
        });
      });
    } else localStorage.setItem(TIME_CALIBRATION_KEY, JSON.stringify(value));
  } catch {
    throw new TimeCalibrationError("storage");
  }
}
export async function calibrateGoogleTime(): Promise<TimeCalibration> {
  // Request before the first await to preserve the click's user activation.
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    try {
      if (
        !(await chrome.permissions.request({
          origins: ["https://www.google.com/*"],
        }))
      )
        throw new TimeCalibrationError("permission");
    } catch {
      throw new TimeCalibrationError("permission");
    }
  }
  let best: { offsetMs: number; latency: number } | undefined;
  for (let sample = 0; sample < 3; sample++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const start = Date.now(),
        tick = performance.now();
      const response = await fetch(
        `https://www.google.com/generate_204?time=${crypto.randomUUID()}`,
        {
          method: "HEAD",
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          signal: controller.signal,
        },
      );
      const latency = performance.now() - tick;
      const date = Date.parse(response.headers.get("Date") ?? "");
      const age = Number(response.headers.get("Age") ?? 0);
      if (
        !response.ok ||
        !Number.isFinite(date) ||
        date <= 0 ||
        age !== 0 ||
        !Number.isFinite(latency) ||
        latency < 0 ||
        latency > 2000 ||
        Math.abs(Date.now() - start - latency) > 1000
      )
        continue;
      // HTTP Date has one-second precision; use the midpoint of that interval.
      const offsetMs = Math.round(date + 500 - (start + latency / 2));
      if (!best || latency < best.latency) best = { offsetMs, latency };
    } catch {
      // A failed sample must not discard a successful lower-latency sample.
    } finally {
      clearTimeout(timeout);
    }
  }
  if (!best) throw new TimeCalibrationError("network");
  const value = { offsetMs: best.offsetMs, calibratedAt: Date.now() };
  if (!valid(value)) throw new TimeCalibrationError("invalid");
  await save(value);
  return value;
}
