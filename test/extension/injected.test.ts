// @vitest-environment jsdom
import {
  afterEach,
  beforeEach,
  expect,
  test,
  vi,
  type MockInstance,
} from "vitest";
let listeners: ((
  request: unknown,
  sender: unknown,
  reply: (value: unknown) => void,
) => unknown)[];
let root: ShadowRoot;
let documentListeners: MockInstance<typeof document.addEventListener>;
let windowListeners: MockInstance<typeof window.addEventListener>;
beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = "";
  listeners = [];
  vi.stubGlobal("__authenticator2FAInstalled", false);
  documentListeners = vi.spyOn(document, "addEventListener");
  windowListeners = vi.spyOn(window, "addEventListener");
  // Preserve the receiver when calling the native method below.
  // oxlint-disable-next-line typescript/unbound-method
  const attach = HTMLElement.prototype.attachShadow;
  vi.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(function (
    this: HTMLElement,
    options,
  ) {
    root = attach.call(this, options);
    return root;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 10,
    top: 10,
    bottom: 50,
    right: 200,
    width: 190,
    height: 40,
    x: 10,
    y: 10,
    toJSON: () => ({}),
  });
  vi.stubGlobal("chrome", {
    runtime: {
      onMessage: {
        addListener: (listener: (typeof listeners)[number]) =>
          listeners.push(listener),
      },
      sendMessage: vi.fn((_request, reply) => {
        reply?.({ ok: false });
        return Promise.resolve();
      }),
    },
  });
  await import("../../src/injected");
});
afterEach(() => {
  for (const [type, listener, options] of documentListeners.mock.calls)
    document.removeEventListener(type, listener, options);
  for (const [type, listener, options] of windowListeners.mock.calls)
    window.removeEventListener(type, listener, options);
  document.querySelector("[data-authenticator-menu]")?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fill(code = "123456") {
  let result: unknown;
  for (const listener of listeners)
    listener({ kind: "fill", code }, {}, (value) => {
      result = value;
    });
  return result;
}
function offerAccount(code = "123456") {
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(((
    request: Record<string, unknown>,
    reply: (value: unknown) => void,
  ) => {
    reply(
      request.type === "input-menu:accounts"
        ? {
            ok: true,
            accounts: [{ id: "one", issuer: "Example", label: "alice" }],
          }
        : { ok: true, code },
    );
    return Promise.resolve();
  }) as typeof chrome.runtime.sendMessage);
}
test.each(["word", "12345", "abc123"])(
  "preserves existing non-code content %s without dispatching edits",
  (value) => {
    document.body.innerHTML = '<input autocomplete="one-time-code">';
    const input = document.querySelector("input")!;
    input.value = value;
    const edited = vi.fn();
    input.addEventListener("input", edited);
    expect(fill()).toBe(false);
    expect(input.value).toBe(value);
    expect(edited).not.toHaveBeenCalled();
  },
);
test.each(["", "   ", "654321", "654 321"])(
  "fills empty or compatible existing numeric content %s",
  (value) => {
    document.body.innerHTML = '<input autocomplete="one-time-code">';
    const input = document.querySelector("input")!;
    input.value = value;
    expect(fill()).toBe(true);
    expect(input.value).toBe("123456");
  },
);
test.each([
  "googleCode",
  "googleAuthenticatorCode",
  "two_factor_code",
  "mfa",
  "passcode",
])("direct fill and the page menu recognize the OTP identifier %s", (id) => {
  offerAccount();
  document.body.innerHTML = `<input id="${id}" inputmode="numeric" maxlength="6">`;
  const input = document.querySelector("input")!;
  expect(fill()).toBe(true);
  input.value = "";
  input.focus();
  expect(document.querySelector("[data-authenticator-menu]")).not.toBeNull();
  root.querySelector("button")!.click();
  expect(input.value).toBe("123456");
});
test.each([
  "otp_secret",
  "security_code",
  "authCode",
  "recoveryCode",
  "mfa_method",
  "authentication_password",
  "googleAuthorizationCode",
  "googleCodeVerifier",
  "googleCouponCode",
  "notgoogleCode",
])("direct fill and the page menu reject the unrelated identifier %s", (id) => {
  offerAccount();
  document.body.innerHTML = `<input id="${id}" inputmode="numeric" maxlength="6">`;
  expect(fill()).toBe(false);
  document.querySelector("input")!.focus();
  expect(document.querySelector("[data-authenticator-menu]")).toBeNull();
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});
test("provider aliases require an OTP-shaped field", () => {
  offerAccount();
  document.body.innerHTML = '<input id="googleCode">';
  expect(fill()).toBe(false);
  document.querySelector("input")!.focus();
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});
test("a menu response rechecks content edited while its code was being requested", () => {
  offerAccount();
  document.body.innerHTML = '<input autocomplete="one-time-code">';
  const input = document.querySelector("input")!;
  input.focus();
  let complete!: (value: unknown) => void;
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(((
    _request: unknown,
    reply: (value: unknown) => void,
  ) => {
    complete = reply;
    return Promise.resolve();
  }) as typeof chrome.runtime.sendMessage);
  root.querySelector("button")!.click();
  input.value = "word";
  complete({ ok: true, code: "123456" });
  expect(input.value).toBe("word");
});
test("split OTP filling validates every cell before changing any content", () => {
  document.body.innerHTML =
    "<form>" +
    Array.from(
      { length: 6 },
      () => '<input maxlength="1" autocomplete="one-time-code">',
    ).join("") +
    "</form>";
  const cells = [...document.querySelectorAll("input")];
  cells[5]!.value = "x";
  expect(fill()).toBe(false);
  expect(cells.map((input) => input.value)).toEqual(["", "", "", "", "", "x"]);
  cells[5]!.value = "9";
  expect(fill()).toBe(true);
  expect(cells.map((input) => input.value).join("")).toBe("123456");
});
test("split OTP filling cannot consume unrelated one-character fields", () => {
  document.body.innerHTML =
    '<form><input maxlength="1" name="username">' +
    Array.from(
      { length: 5 },
      () => '<input maxlength="1" autocomplete="one-time-code">',
    ).join("") +
    "</form>";
  expect(fill()).toBe(false);
  expect(
    [...document.querySelectorAll("input")].every(
      (input) => input.value === "",
    ),
  ).toBe(true);
});
test("lettered OTP codes never report success in a numeric-only control", () => {
  document.body.innerHTML =
    '<input type="number" autocomplete="one-time-code">';
  expect(fill("BCDF2")).toBe(false);
  expect(document.querySelector("input")!.value).toBe("");
});
test("fills identified OTP fields without modifying login/password fields or submitting", () => {
  document.body.innerHTML =
    "<form><input name=username><input type=password autocomplete=current-password><input autocomplete=one-time-code></form>";
  const submit = vi.fn();
  document.querySelector("form")!.addEventListener("submit", submit);
  expect(fill()).toBe(true);
  expect([...document.querySelectorAll("input")].map((x) => x.value)).toEqual([
    "",
    "",
    "123456",
  ]);
  expect(submit).not.toHaveBeenCalled();
});
test.each([
  "<input name=username><input type=password autocomplete=current-password>",
  "<input name=otp><input name=otp>",
  "<input name=otp disabled>",
  "<input name=otp readonly>",
  "<input name=otp maxlength=4>",
])("refuses unsafe or ambiguous input targets: %s", (html) => {
  document.body.innerHTML = html;
  expect(fill()).toBe(false);
  expect(
    [...document.querySelectorAll("input")].every((x) => x.value === ""),
  ).toBe(true);
});
test("fills a complete split OTP form and refuses malformed codes", () => {
  document.body.innerHTML =
    "<form>" +
    Array.from(
      { length: 6 },
      () => "<input maxlength=1 autocomplete=one-time-code>",
    ).join("") +
    "</form>";
  expect(fill()).toBe(true);
  expect(
    [...document.querySelectorAll("input")].map((x) => x.value).join(""),
  ).toBe("123456");
  expect(fill("secret")).toBe(false);
});
test("the page menu displays labels and fetches the code only after an explicit selection", () => {
  document.body.innerHTML = "<input name=otp><input name=username>";
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(((
    request: Record<string, unknown>,
    reply: (value: unknown) => void,
  ) => {
    reply(
      request.type === "input-menu:accounts"
        ? {
            ok: true,
            accounts: [{ id: "one", issuer: "Example", label: "alice" }],
          }
        : { ok: true, code: "123456" },
    );
    return Promise.resolve();
  }) as typeof chrome.runtime.sendMessage);
  const input = document.querySelector("input")!;
  input.focus();
  expect(root.textContent).toContain("Example alice");
  expect(root.textContent).not.toContain("123456");
  expect(input.value).toBe("");
  expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
  root.querySelector("button")!.focus();
  expect(document.querySelector("[data-authenticator-menu]")).not.toBeNull();
  root.querySelector("button")!.click();
  expect(input.value).toBe("123456");
  expect(document.querySelector("[data-authenticator-menu]")).toBeNull();
});
test("late menu selection cannot fill after focus changes or after the menu is reset", () => {
  document.body.innerHTML = "<input name=otp><input name=username>";
  let complete!: (value: unknown) => void;
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(((
    request: Record<string, unknown>,
    reply: (value: unknown) => void,
  ) => {
    if (request.type === "input-menu:accounts")
      reply({
        ok: true,
        accounts: [{ id: "one", issuer: "Example", label: "alice" }],
      });
    else complete = reply;
    return Promise.resolve();
  }) as typeof chrome.runtime.sendMessage);
  const [otp, username] = [...document.querySelectorAll("input")];
  otp!.focus();
  root.querySelector("button")!.click();
  username!.focus();
  complete({ ok: true, code: "123456" });
  expect(otp!.value).toBe("");
  expect(username!.value).toBe("");
  otp!.focus();
  for (const listener of listeners)
    listener({ kind: "input-menu:refresh" }, {}, () => {});
  expect(document.querySelector("[data-authenticator-menu]")).toBeNull();
});

test.each([false, true])(
  "page QR selection supports a focused click and dragged region: drag %s",
  (drag) => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(((
      _request: unknown,
      reply?: (value: unknown) => void,
    ) => {
      reply?.({ ok: true, value: { added: 1 } });
      return Promise.resolve();
    }) as typeof chrome.runtime.sendMessage);
    for (const listener of listeners) listener({ kind: "scan" }, {}, () => {});
    const cover = document.getElementById("authenticator-2fa-selection")!;
    cover.setPointerCapture = vi.fn();
    cover.onpointerdown!({
      clientX: 100,
      clientY: 100,
      pointerId: 1,
    } as PointerEvent);
    cover.onpointerup!({
      clientX: drag ? 200 : 100,
      clientY: drag ? 220 : 100,
      pointerId: 1,
    } as PointerEvent);
    const capture = vi.mocked(chrome.runtime.sendMessage).mock
      .calls[0]![0] as unknown as Record<string, unknown>;
    expect(capture.kind).toBe("capture");
    expect(capture.x).toBeGreaterThanOrEqual(0);
    expect(capture.y).toBeGreaterThanOrEqual(0);
    if (drag) {
      expect(capture.width).toBe(100);
      expect(capture.height).toBe(120);
      expect(capture.focus).toBeUndefined();
    } else expect(capture.focus).toEqual({ x: 100, y: 100 });
    expect(document.getElementById("authenticator-2fa-selection")).toBeNull();
  },
);
