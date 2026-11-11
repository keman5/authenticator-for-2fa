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
let observers: MutationObserver[];
beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = "";
  listeners = [];
  observers = [];
  // Preserve the receiver when calling the native method below.
  // oxlint-disable-next-line typescript/unbound-method
  const observe = MutationObserver.prototype.observe;
  vi.spyOn(MutationObserver.prototype, "observe").mockImplementation(function (
    this: MutationObserver,
    ...args
  ) {
    observers.push(this);
    observe.apply(this, args);
  });
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
  for (const listener of listeners)
    listener({ kind: "input-menu:refresh" }, {}, () => {});
  for (const observer of observers) observer.disconnect();
  for (const [type, listener, options] of documentListeners.mock.calls)
    document.removeEventListener(type, listener, options);
  for (const [type, listener, options] of windowListeners.mock.calls)
    window.removeEventListener(type, listener, options);
  document.querySelector("[data-authenticator-menu]")?.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
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
            countdown: { period: 30, offsetMs: 0 },
          }
        : { ok: true, code },
    );
    return Promise.resolve();
  }) as typeof chrome.runtime.sendMessage);
}
test("the page entry uses the countdown logo, warns before expiry and resets with the next code", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-10T00:00:10Z"));
  offerAccount();
  document.body.innerHTML = '<input autocomplete="one-time-code">';
  const input = document.querySelector("input")!;
  input.focus();
  const trigger = root.querySelector<HTMLButtonElement>(
    "[data-authenticator-trigger]",
  )!;
  const arcs = Array.from(trigger.querySelectorAll("circle[stroke-dasharray]"));
  expect(arcs).toHaveLength(4);
  expect(trigger.textContent).not.toContain("2FA");
  const partial = arcs[2]!.getAttribute("stroke-dasharray");
  vi.advanceTimersByTime(1000);
  expect(arcs[2]!.getAttribute("stroke-dasharray")).not.toBe(partial);
  vi.advanceTimersByTime(15000);
  expect(arcs.map((arc) => arc.getAttribute("stroke"))).toEqual(
    Array(4).fill("#EA4335"),
  );
  vi.advanceTimersByTime(4000);
  expect(arcs.map((arc) => arc.getAttribute("stroke"))).toEqual([
    "#EA4335",
    "#FBBC05",
    "#4285F4",
    "#34A853",
  ]);
  expect(document.activeElement).toBe(input);
  expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(document.querySelector("[data-authenticator-menu]")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
test.each([
  '<label for="code">Authentication code</label><input id="code" inputmode="numeric" maxlength="6">',
  '<span id="code-label">验证码</span><input name="code" aria-labelledby="code-label" maxlength="6">',
  '<form><h2>Two-factor authentication</h2><label>Code<input name="code" inputmode="numeric" maxlength="6"></label></form>',
  '<dialog open><h2>Two-factor authentication</h2><label>Code<input name="code" inputmode="numeric" maxlength="6"></label></dialog>',
])(
  "recognizes a two-factor settings field from its accessible label or form: %s",
  (html) => {
    offerAccount();
    document.body.innerHTML = html;
    const input = document.querySelector("input")!;
    input.focus();
    expect(document.querySelector("[data-authenticator-menu]")).not.toBeNull();
    expect(root.querySelector("[data-authenticator-trigger]")).not.toBeNull();
    input.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(document.querySelector("[data-authenticator-menu]")).not.toBeNull();
    root
      .querySelector<HTMLButtonElement>("[data-authenticator-account]")!
      .click();
    expect(input.value).toBe("123456");
  },
);
test("shows an upper-right entry for a dynamically inserted two-factor dialog without stealing focus", async () => {
  offerAccount();
  document.body.innerHTML = '<button id="settings">Settings</button>';
  document.querySelector<HTMLButtonElement>("#settings")!.focus();
  const active = document.activeElement;
  document.body.insertAdjacentHTML(
    "beforeend",
    '<div role="dialog"><label for="code">Verification code</label><input id="code" inputmode="numeric" maxlength="6"></div>',
  );
  await vi.waitFor(() =>
    expect(document.querySelector("[data-authenticator-menu]")).not.toBeNull(),
  );
  expect(document.activeElement).toBe(active);
  const trigger = root.querySelector<HTMLButtonElement>(
    "[data-authenticator-trigger]",
  )!;
  expect(trigger.style.top).toBe("0px");
  expect(root.querySelector<HTMLElement>('[role="group"]')!.hidden).toBe(true);
  trigger.click();
  expect(root.querySelector<HTMLElement>('[role="group"]')!.hidden).toBe(false);
  root
    .querySelector<HTMLButtonElement>("[data-authenticator-account]")!
    .click();
  expect(document.querySelector("input")!.value).toBe("123456");
});
test("an authenticator form heading cannot turn a recovery-code field into an OTP target", () => {
  offerAccount();
  document.body.innerHTML =
    '<form><h2>Two-factor authentication</h2><label>Recovery code<input name="code" inputmode="numeric" maxlength="6"></label></form>';
  document.querySelector("input")!.focus();
  expect(fill()).toBe(false);
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});
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
test("the page menu displays masked labels and fills only after an explicit selection", () => {
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
  expect(root.querySelector(".label")?.textContent).toBe("alice");
  expect(root.textContent).not.toContain("Example");
  expect(root.textContent).not.toContain("123456");
  expect(input.value).toBe("");
  expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
  root.querySelector("button")!.focus();
  expect(document.querySelector("[data-authenticator-menu]")).not.toBeNull();
  root.querySelector("button")!.click();
  expect(input.value).toBe("123456");
  expect(document.querySelector("[data-authenticator-menu]")).toBeNull();
});

test("the external top-right trigger opens on hover without focus or filling", () => {
  offerAccount();
  document.body.innerHTML = '<input autocomplete="one-time-code">';
  const input = document.querySelector("input")!;
  input.focus();
  const trigger = root.querySelector<HTMLButtonElement>(
    "[data-authenticator-trigger]",
  )!;
  const list = root.querySelector<HTMLElement>('[role="group"]')!;
  expect(parseFloat(trigger.style.left)).toBeGreaterThanOrEqual(200);
  expect(parseFloat(trigger.style.top)).toBeLessThanOrEqual(10);
  expect(list.hidden).toBe(true);
  trigger.dispatchEvent(new Event("pointerenter"));
  expect(list.hidden).toBe(false);
  expect(root.querySelector("[data-authenticator-code]")?.textContent).toBe(
    "******",
  );
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("");
  expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
});

test("hover reveals only its row, ignores late replies, masks on leave and refreshes at rollover", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-10T00:00:24Z"));
  const replies: ((value: unknown) => void)[] = [];
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(((
    request: Record<string, unknown>,
    reply: (value: unknown) => void,
  ) => {
    if (request.type === "input-menu:accounts")
      reply({
        ok: true,
        accounts: [
          {
            id: "one",
            issuer: "Example",
            label: "alice",
            digits: 6,
            period: 30,
          },
          { id: "two", issuer: "Example", label: "bob", digits: 8, period: 60 },
        ],
        countdown: { period: 30, offsetMs: 0 },
      });
    else replies.push(reply);
    return Promise.resolve();
  }) as typeof chrome.runtime.sendMessage);
  document.body.innerHTML = '<input autocomplete="one-time-code">';
  document.querySelector("input")!.focus();
  root
    .querySelector("[data-authenticator-trigger]")!
    .dispatchEvent(new Event("pointerenter"));
  const [one, two] = [
    ...root.querySelectorAll<HTMLButtonElement>("[data-authenticator-account]"),
  ];
  const code = (row: HTMLButtonElement) =>
    row.querySelector<HTMLElement>("[data-authenticator-code]")!;
  expect(code(one!).textContent).toBe("******");
  expect(code(two!).textContent).toBe("********");
  one!.dispatchEvent(new Event("pointerenter"));
  one!.dispatchEvent(new Event("pointerleave"));
  replies.shift()!({ ok: true, code: "123456" });
  expect(code(one!).textContent).toBe("******");
  one!.dispatchEvent(new Event("pointerenter"));
  replies.shift()!({ ok: true, code: "123456" });
  expect(code(one!).textContent).toBe("123456");
  vi.advanceTimersByTime(1000);
  expect(code(one!).style.color).toBe("rgb(234, 67, 53)");
  expect(code(two!).style.color).toBe("rgb(66, 133, 244)");
  vi.advanceTimersByTime(5000);
  expect(code(one!).textContent).toBe("******");
  replies.shift()!({ ok: true, code: "654321" });
  expect(code(one!).textContent).toBe("654321");
  expect(code(one!).style.color).toBe("rgb(66, 133, 244)");
  one!.dispatchEvent(new Event("pointerleave"));
  expect(code(one!).textContent).toBe("******");
  expect(document.querySelector("input")!.value).toBe("");
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
    const cover = document.getElementById("authenticator-for-2fa-selection")!;
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
    expect(document.getElementById("authenticator-for-2fa-selection")).toBeNull();
  },
);
