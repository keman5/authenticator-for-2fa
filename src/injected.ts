const injectedScope = globalThis as typeof globalThis & {
  __authenticator2FAInstalled?: boolean;
};
if (!injectedScope.__authenticator2FAInstalled) {
  injectedScope.__authenticator2FAInstalled = true;
  installPageMenu();
  chrome.runtime.onMessage.addListener((value: unknown, _sender, reply) => {
    if (!value || typeof value !== "object") return;
    const request = value as { kind?: string; code?: unknown };
    if (request.kind === "fill") {
      reply(fill(request.code));
      return;
    }
    if (request.kind === "scan") {
      selectRegion();
      reply(true);
    }
  });
}
function writable(input: HTMLInputElement): boolean {
  const rect = input.getBoundingClientRect();
  const style = getComputedStyle(input);
  return (
    !input.disabled &&
    !input.readOnly &&
    rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    ["text", "tel", "number", "password"].includes(input.type) &&
    input.autocomplete !== "current-password" &&
    input.autocomplete !== "new-password"
  );
}
function fieldHints(input: HTMLInputElement): string {
  return [
    input.name,
    input.id,
    input.placeholder,
    input.getAttribute("aria-label") ?? "",
  ]
    .join(" ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}
function otpScore(input: HTMLInputElement): number {
  const words = fieldHints(input).split(/[^a-z0-9\u3000-\u9fff]+/);
  const has = (word: string) => words.includes(word);
  if (
    [
      "secret",
      "password",
      "recovery",
      "coupon",
      "postal",
      "source",
      "authorization",
      "verifier",
      "method",
    ].some(has)
  )
    return 0;
  if (input.autocomplete === "one-time-code") return 100;
  const phrase = (first: string, second: string) =>
    words.some((word, index) => word === first && words[index + 1] === second);
  const standard =
    [
      "otp",
      "totp",
      "hotp",
      "mfa",
      "2fa",
      "verification",
      "authentication",
      "authenticator",
      "passcode",
    ].some(has) ||
    phrase("two", "factor") ||
    phrase("one", "time") ||
    phrase("login", "code") ||
    phrase("verify", "code") ||
    /验证码|認証コード/.test(fieldHints(input));
  if (standard) return 60;
  const shaped =
    input.inputMode === "numeric" ||
    input.type === "number" ||
    (input.maxLength >= 5 && input.maxLength <= 10);
  return shaped && has("google") && has("code") ? 60 : 0;
}
function replaceable(input: HTMLInputElement, code: string): boolean {
  const numeric = /^\d+$/.test(code);
  if (
    !numeric &&
    (input.type === "number" ||
      input.inputMode === "numeric" ||
      input.inputMode === "decimal")
  )
    return false;
  const before = input.value.replace(/\s/g, "");
  if (!before) return true;
  if (before.length !== code.length) return false;
  return numeric
    ? /^\d+$/.test(before)
    : /^[a-z0-9]+$/i.test(before) && /[a-z]/i.test(before);
}
function fill(value: unknown, target?: HTMLInputElement): boolean {
  if (
    typeof value !== "string" ||
    !/^(?:[0-9]{6,8}|[23456789BCDFGHJKMNPQRTVWXY]{5})$/.test(value)
  )
    return false;
  const eligible = target
    ? [target].filter(writable)
    : Array.from(document.querySelectorAll("input")).filter(writable);
  const ordered = eligible
    .map((input) => ({ input, score: otpScore(input) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  const winner = ordered[0];
  if (!winner) return false;
  if (ordered[1]?.score === winner.score && winner.input.maxLength !== 1)
    return false;
  const write = (input: HTMLInputElement, text: string) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, text);
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      }),
    );
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  if (winner.input.maxLength === 1) {
    const scope = winner.input.form ?? winner.input.parentElement;
    if (!scope) return false;
    const cells = Array.from(scope.querySelectorAll("input")).filter(
      (item) =>
        writable(item) &&
        item.maxLength === 1 &&
        (otpScore(item) > 0 || !fieldHints(item).trim()),
    );
    if (
      cells.length !== value.length ||
      !cells.every((cell, index) => replaceable(cell, value[index]!))
    )
      return false;
    cells.forEach((cell, i) => write(cell, value[i]!));
    return true;
  }
  if (winner.input.maxLength > 0 && winner.input.maxLength < value.length)
    return false;
  if (!replaceable(winner.input, value)) return false;
  write(winner.input, value);
  return true;
}
function selectRegion(): void {
  if (document.getElementById("authenticator-2fa-selection")) return;
  const cover = document.createElement("div");
  cover.id = "authenticator-2fa-selection";
  Object.assign(cover.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    cursor: "crosshair",
    background: "rgba(0,0,0,.25)",
    touchAction: "none",
  });
  const box = document.createElement("div");
  Object.assign(box.style, {
    position: "absolute",
    border: "2px solid white",
    background: "transparent",
    pointerEvents: "none",
  });
  cover.append(box);
  let start: { x: number; y: number } | undefined;
  const close = () => {
    cover.remove();
    document.removeEventListener("keydown", escape);
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      close();
      void chrome.runtime.sendMessage({ kind: "scan-cancel" }).catch(() => {});
    }
  };
  document.addEventListener("keydown", escape);
  cover.onpointerdown = (event) => {
    start = { x: event.clientX, y: event.clientY };
    cover.setPointerCapture(event.pointerId);
  };
  cover.onpointermove = (event) => {
    if (!start) return;
    Object.assign(box.style, {
      left: Math.min(start.x, event.clientX) + "px",
      top: Math.min(start.y, event.clientY) + "px",
      width: Math.abs(event.clientX - start.x) + "px",
      height: Math.abs(event.clientY - start.y) + "px",
    });
  };
  cover.onpointerup = (event) => {
    if (!start) {
      close();
      return;
    }
    let x = Math.min(start.x, event.clientX),
      y = Math.min(start.y, event.clientY),
      width = Math.abs(start.x - event.clientX),
      height = Math.abs(start.y - event.clientY);
    let focus: { x: number; y: number } | undefined;
    if (Math.max(width, height) <= 8) {
      width = Math.min(512, innerWidth);
      height = Math.min(512, innerHeight);
      x = Math.max(0, Math.min(event.clientX - width / 2, innerWidth - width));
      y = Math.max(
        0,
        Math.min(event.clientY - height / 2, innerHeight - height),
      );
      focus = {
        x: Math.max(0, Math.min(width, event.clientX - x)),
        y: Math.max(0, Math.min(height, event.clientY - y)),
      };
    }
    close();
    if (width < 4 || height < 4) {
      void chrome.runtime.sendMessage({ kind: "scan-cancel" }).catch(() => {});
      return;
    }
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        chrome.runtime.sendMessage(
          {
            kind: "capture",
            x,
            y,
            width,
            height,
            viewport: innerWidth,
            ...(focus ? { focus } : {}),
          },
          (result: {
            ok: boolean;
            value?: { added: number };
            error?: string;
          }) => {
            const error = chrome.runtime.lastError;
            if (error || !result?.ok)
              void chrome.runtime
                .sendMessage({
                  kind: "scan-failed",
                  error:
                    error?.message ??
                    result?.error ??
                    "No QR code could be decoded from the selected image. Use a clear image with the whole QR code visible.",
                })
                .catch(() => {});
          },
        ),
      ),
    );
  };
  document.documentElement.append(cover);
}

function installPageMenu() {
  let panel: HTMLDivElement | undefined,
    epoch = 0;
  const close = () => {
    epoch++;
    panel?.remove();
    panel = undefined;
  };
  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (
      message &&
      typeof message === "object" &&
      "kind" in message &&
      message.kind === "input-menu:refresh"
    )
      close();
  });
  const eligible = (input: HTMLInputElement) =>
    writable(input) && otpScore(input) > 0;
  document.addEventListener("focusin", (event) => {
    if (panel && event.composedPath().includes(panel)) return;
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !eligible(input)) {
      close();
      return;
    }
    close();
    const revision = epoch;
    chrome.runtime.sendMessage(
      { type: "input-menu:accounts" },
      (
        response:
          | {
              ok?: boolean;
              accounts?: { id: string; issuer: string; label: string }[];
            }
          | undefined,
      ) => {
        if (
          chrome.runtime.lastError ||
          !response?.ok ||
          !response.accounts?.length ||
          revision !== epoch ||
          !input.isConnected ||
          document.activeElement !== input
        )
          return;
        panel = document.createElement("div");
        panel.dataset.authenticatorMenu = "";
        const bounds = input.getBoundingClientRect();
        Object.assign(panel.style, {
          position: "fixed",
          left: Math.max(0, Math.min(bounds.left, innerWidth - 300)) + "px",
          top:
            Math.max(0, Math.min(bounds.bottom + 4, innerHeight - 180)) + "px",
          zIndex: "2147483647",
        });
        const root = panel.attachShadow({ mode: "closed" });
        const style = document.createElement("style");
        style.textContent =
          ":host{color-scheme:light dark}div{padding:4px;max-height:160px;overflow:auto;width:280px;background:Canvas;color:CanvasText;border:1px solid GrayText;border-radius:8px;font:13px system-ui;box-shadow:0 6px 24px #0003}button{display:block;width:100%;padding:8px;text-align:left;border:0;border-radius:4px;background:transparent;color:inherit;font:inherit;cursor:pointer}button:hover,button:focus-visible{background:Highlight;color:HighlightText}";
        root.append(style);
        const list = document.createElement("div");
        list.setAttribute("role", "group");
        for (const account of response.accounts.slice(0, 30)) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = `${account.issuer} ${account.label}`.trim();
          button.addEventListener("pointerdown", (event) =>
            event.preventDefault(),
          );
          button.onclick = () => {
            button.disabled = true;
            chrome.runtime.sendMessage(
              { type: "input-menu:code", accountId: account.id },
              (value: { ok?: boolean; code?: string } | undefined) => {
                if (
                  !chrome.runtime.lastError &&
                  revision === epoch &&
                  value?.ok &&
                  typeof value.code === "string" &&
                  input.isConnected &&
                  eligible(input)
                )
                  fill(value.code, input);
                close();
              },
            );
          };
          list.append(button);
        }
        root.append(list);
        document.documentElement.append(panel);
      },
    );
  });
  document.addEventListener("pointerdown", (event) => {
    if (panel && !event.composedPath().includes(panel)) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
  document.addEventListener("scroll", close, true);
  window.addEventListener("resize", close);
}

export {};
