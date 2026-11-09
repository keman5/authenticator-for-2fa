import { it, expect, vi, afterEach } from "vitest";
import {
  nativeTouchID,
  TOUCH_ID_HOST,
  touchID,
  TouchIDError,
} from "../src/platform/touchID";
afterEach(() => vi.unstubAllGlobals());
function runtime(
  reply: (request: Record<string, unknown>) => unknown,
  url = "chrome-extension://test/",
) {
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  const send = vi.fn(
    (
      _host: string,
      message: Record<string, unknown>,
      callback: (reply: unknown) => void,
    ) => callback(reply(message)),
  );
  vi.stubGlobal("chrome", {
    runtime: {
      getURL: () => url,
      sendNativeMessage: send,
      lastError: undefined,
    },
  });
  return send;
}
it("requires a fresh correlated native proof and uses the correct native host", async () => {
  const send = runtime((request) => ({
    version: 1,
    nonce: request.nonce,
    supported: true,
    verified: true,
  }));
  await nativeTouchID("authenticate", "Unlock");
  expect(send.mock.calls[0]?.[0]).toBe(TOUCH_ID_HOST);
  await nativeTouchID("authenticate", "Unlock");
  expect(send.mock.calls[0]?.[1].nonce).not.toEqual(
    send.mock.calls[1]?.[1].nonce,
  );
  const safari = runtime(
    (request) => ({
      version: 1,
      nonce: request.nonce,
      supported: true,
      verified: false,
    }),
    "safari-web-extension://test/",
  );
  await nativeTouchID("status");
  expect(safari.mock.calls[0]?.[0]).toBe("local.Authenticator-Workspace");
});
it.each(["cancelled", "locked", "notEnrolled", "unavailable", "failed"])(
  "never treats native %s as a successful unlock",
  async (error) => {
    runtime((request) => ({
      version: 1,
      nonce: request.nonce,
      supported: true,
      verified: false,
      error,
    }));
    await expect(nativeTouchID("authenticate", "Unlock")).rejects.toMatchObject(
      { code: error },
    );
  },
);
it.each([
  { version: 1, nonce: "old-response", supported: true, verified: true },
  { version: 2, supported: true, verified: true },
  { supported: true, verified: true },
  null,
])("rejects invalid or replayed responses", async (value) => {
  runtime(() => value);
  await expect(nativeTouchID("authenticate", "Unlock")).rejects.toBeInstanceOf(
    TouchIDError,
  );
});
it("availability cannot unlock and failed authentication cannot be confused with it", async () => {
  runtime((request) => ({
    version: 1,
    nonce: request.nonce,
    supported: true,
    verified: false,
  }));
  await nativeTouchID("status");
  await expect(nativeTouchID("authenticate", "Unlock")).rejects.toMatchObject({
    code: "failed",
  });
});
it("reports missing native component and routes UI requests through the background", async () => {
  runtime(() => {
    Object.defineProperty(chrome.runtime, "lastError", {
      value: { message: "not found" },
      configurable: true,
    });
    return undefined;
  });
  await expect(nativeTouchID("status")).rejects.toMatchObject({
    code: "bridge",
  });
  runtime(() => undefined);
  Object.assign(chrome.runtime, {
    sendMessage: (_message: unknown, reply: (result: unknown) => void) =>
      reply({ ok: false, error: "cancelled" }),
  });
  await expect(touchID("authenticate", "Unlock")).rejects.toMatchObject({
    code: "cancelled",
  });
});
