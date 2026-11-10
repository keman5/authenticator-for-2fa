import logoMarkup from "../assets/brand/icons/authenticator-2fa-icon.svg?raw";

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
    ...Array.from(
      input.labels ?? [],
      (label) => label.textContent?.slice(0, 512) ?? "",
    ),
    ...(input.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/)
      .slice(0, 10)
      .map(
        (id) => document.getElementById(id)?.textContent?.slice(0, 512) ?? "",
      ),
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
  const scope = input.closest('form,fieldset,dialog,[role="dialog"]');
  const heading = Array.from(
    scope?.querySelectorAll("h1,h2,h3,legend") ?? [],
    (item) => item.textContent ?? "",
  ).join(" ");
  const twoFactorForm =
    /two[ -]factor|multi[ -]factor|authenticator|authentication|双重验证|二步验证|两步验证/i.test(
      heading,
    );
  return shaped && has("code") && (has("google") || twoFactorForm) ? 60 : 0;
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
    currentInput: HTMLInputElement | undefined,
    place: (() => void) | undefined,
    epoch = 0,
    hideTimer: ReturnType<typeof setTimeout> | undefined,
    countdownTimer: ReturnType<typeof setInterval> | undefined;
  const close = () => {
    epoch++;
    clearInterval(countdownTimer);
    clearTimeout(hideTimer);
    countdownTimer = undefined;
    panel?.remove();
    panel = undefined;
    currentInput = undefined;
    place = undefined;
  };
  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (
      message &&
      typeof message === "object" &&
      "kind" in message &&
      message.kind === "input-menu:refresh"
    ) {
      close();
      if ("rediscover" in message && message.rediscover === true) discover();
    }
  });
  const eligible = (input: HTMLInputElement) =>
    writable(input) && otpScore(input) > 0;
  const show = (input: HTMLInputElement, focused: boolean) => {
    close();
    currentInput = input;
    const revision = epoch;
    chrome.runtime.sendMessage(
      { type: "input-menu:accounts" },
      (
        response:
          | {
              ok?: boolean;
              accounts?: {
                id: string;
                issuer: string;
                label: string;
                digits?: number;
                period?: number | null;
              }[];
              countdown?: { period: number; offsetMs: number };
            }
          | undefined,
      ) => {
        if (
          chrome.runtime.lastError ||
          !response?.ok ||
          !response.accounts?.length ||
          revision !== epoch ||
          !input.isConnected ||
          !eligible(input) ||
          (focused && document.activeElement !== input)
        )
          return;
        panel = document.createElement("div");
        panel.dataset.authenticatorMenu = "";
        Object.assign(panel.style, {
          position: "fixed",
          zIndex: "2147483647",
        });
        const root = panel.attachShadow({ mode: "closed" });
        const style = document.createElement("style");
        style.textContent =
          ":host{color-scheme:light dark}div{box-sizing:border-box;padding:4px;max-height:240px;overflow:auto;width:280px;max-width:calc(100vw - 16px);background:Canvas;color:CanvasText;border:1px solid GrayText;border-radius:8px;font:13px system-ui;box-shadow:0 6px 24px #0003}button{display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;padding:8px;text-align:left;border:0;border-radius:4px;background:transparent;color:inherit;font:inherit;cursor:pointer}button:hover,button:focus-visible{background:color-mix(in srgb,CanvasText 8%,Canvas)}.label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.code{flex-shrink:0;font:600 14px ui-monospace,monospace;font-variant-numeric:tabular-nums;letter-spacing:.08em}.trigger{position:fixed;display:grid;place-items:center;box-sizing:border-box;width:28px;height:24px;padding:0;border:0;border-radius:50%;background:transparent;cursor:pointer}.trigger svg{display:block;width:24px;height:24px;overflow:visible}.trigger:focus-visible{outline:2px solid Highlight;outline-offset:2px}";
        root.append(style);
        const list = document.createElement("div");
        list.setAttribute("role", "group");
        list.setAttribute("aria-label", "Authenticator - 2FA");
        list.hidden = true;
        const rows: {
          button: HTMLButtonElement;
          code: HTMLSpanElement;
          mask: string;
          period: number | null;
          cycle: number;
          request: number;
        }[] = [];
        let hovered: (typeof rows)[number] | undefined;
        const time = () =>
          (Date.now() + (response.countdown?.offsetMs ?? 0)) / 1000;
        const mask = (row: (typeof rows)[number]) => {
          row.request++;
          row.code.textContent = row.mask;
        };
        const preview = (row: (typeof rows)[number]) => {
          mask(row);
          const pending = row.request;
          row.cycle = row.period ? Math.floor(time() / row.period) : 0;
          const cycle = row.cycle;
          chrome.runtime.sendMessage(
            {
              type: "input-menu:code",
              accountId: row.button.dataset.accountId,
            },
            (value: { ok?: boolean; code?: string } | undefined) => {
              if (
                revision !== epoch ||
                pending !== row.request ||
                hovered !== row ||
                list.hidden
              )
                return;
              if (
                chrome.runtime.lastError ||
                !value?.ok ||
                typeof value.code !== "string"
              ) {
                mask(row);
                return;
              }
              if (!row.period || Math.floor(time() / row.period) === cycle)
                row.code.textContent = value.code;
            },
          );
        };
        const hideList = () => {
          list.hidden = true;
          hovered = undefined;
          rows.forEach(mask);
          trigger.setAttribute("aria-expanded", "false");
        };
        const openList = () => {
          clearTimeout(hideTimer);
          list.hidden = false;
          trigger.setAttribute("aria-expanded", "true");
        };
        const scheduleHide = () => {
          clearTimeout(hideTimer);
          hideTimer = setTimeout(hideList, 180);
        };
        list.addEventListener("pointerenter", () => clearTimeout(hideTimer));
        list.addEventListener("pointerleave", scheduleHide);
        for (const account of response.accounts.slice(0, 30)) {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.authenticatorAccount = "";
          button.dataset.accountId = account.id;
          const label = document.createElement("span");
          label.className = "label";
          label.textContent = account.label;
          const code = document.createElement("span");
          code.className = "code";
          code.dataset.authenticatorCode = "";
          const digits = [5, 6, 7, 8].includes(account.digits ?? 6)
            ? (account.digits ?? 6)
            : 6;
          const period =
            account.period === null
              ? null
              : Number.isFinite(account.period) && account.period! > 0
                ? account.period!
                : (response.countdown?.period ?? 30);
          const row = {
            button,
            code,
            mask: "*".repeat(digits),
            period,
            cycle: -1,
            request: 0,
          };
          code.textContent = row.mask;
          rows.push(row);
          button.append(label, code);
          const reveal = () => {
            if (hovered === row) return;
            if (hovered) mask(hovered);
            hovered = row;
            openList();
            preview(row);
          };
          const conceal = () => {
            mask(row);
            if (hovered === row) hovered = undefined;
          };
          button.addEventListener("pointerenter", reveal);
          button.addEventListener("pointerleave", conceal);
          button.addEventListener("focus", reveal);
          button.addEventListener("blur", conceal);
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
        const trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = "trigger";
        trigger.dataset.authenticatorTrigger = "";
        const logo = document.importNode(
          new DOMParser().parseFromString(logoMarkup, "image/svg+xml")
            .documentElement,
          true,
        );
        logo.setAttribute("aria-hidden", "true");
        logo.querySelector("title")?.remove();
        trigger.append(logo);
        const arcs = Array.from(
          logo.querySelectorAll("circle[stroke-dasharray]"),
        );
        const colors = arcs.map((arc) => arc.getAttribute("stroke")!);
        const countdown = response.countdown;
        const updateRows = () => {
          if (!input.isConnected || !eligible(input) || !panel?.isConnected) {
            close();
            return;
          }
          const seconds = time();
          rows.forEach((row) => {
            const remaining = row.period
              ? row.period -
                (((seconds % row.period) + row.period) % row.period)
              : Infinity;
            row.code.style.color = remaining <= 5 ? "#EA4335" : "#4285F4";
            if (
              hovered === row &&
              row.period &&
              row.cycle !== Math.floor(seconds / row.period)
            )
              preview(row);
          });
        };
        let updateCountdown = updateRows;
        if (
          countdown &&
          Number.isFinite(countdown.period) &&
          countdown.period > 0 &&
          Number.isFinite(countdown.offsetMs)
        ) {
          updateCountdown = () => {
            if (!input.isConnected || !eligible(input) || !panel?.isConnected) {
              close();
              return;
            }
            const seconds = (Date.now() + countdown.offsetMs) / 1000;
            const remaining =
              countdown.period -
              (((seconds % countdown.period) + countdown.period) %
                countdown.period);
            arcs.forEach((arc, index) => {
              arc.setAttribute(
                "stroke",
                remaining <= 5 ? "#EA4335" : colors[index]!,
              );
              arc.setAttribute(
                "stroke-dasharray",
                `${(29.2853 * Math.max(0, Math.min(1, (remaining / countdown.period) * 4 - index))).toFixed(4)} 126.9218`,
              );
            });
            updateRows();
          };
        }
        trigger.setAttribute("aria-label", "Authenticator - 2FA");
        trigger.setAttribute("aria-expanded", "false");
        trigger.setAttribute("aria-haspopup", "true");
        trigger.addEventListener("pointerdown", (event) =>
          event.preventDefault(),
        );
        trigger.onclick = () => {
          if (list.hidden) openList();
          else hideList();
        };
        trigger.addEventListener("pointerenter", openList);
        trigger.addEventListener("pointerleave", scheduleHide);
        trigger.addEventListener("focus", openList);
        root.append(trigger);
        place = () => {
          if (!panel) return;
          const bounds = input.getBoundingClientRect();
          const left = Math.max(0, Math.min(bounds.right + 4, innerWidth - 28));
          const top = Math.max(0, Math.min(bounds.top - 28, innerHeight - 24));
          panel.style.left =
            Math.max(8, Math.min(left + 28 - 280, innerWidth - 288)) + "px";
          panel.style.top =
            Math.max(0, Math.min(top + 28, innerHeight - 244)) + "px";
          trigger.style.left = left + "px";
          trigger.style.top = top + "px";
        };
        place();
        // Native modal dialogs occupy the top layer; their controls must keep
        // the entry point inside that layer rather than behind the dialog.
        (input.closest("dialog[open]") ?? document.documentElement).append(
          panel,
        );
        if (updateCountdown) {
          updateCountdown();
          countdownTimer = setInterval(updateCountdown, 100);
        }
      },
    );
  };
  document.addEventListener("focusin", (event) => {
    if (panel && event.composedPath().includes(panel)) return;
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !eligible(input)) {
      close();
      return;
    }
    show(input, true);
  });
  const discover = () => {
    if (currentInput?.isConnected && eligible(currentInput)) {
      place?.();
      return;
    }
    close();
    const input = Array.from(document.querySelectorAll("input")).find(eligible);
    if (input) show(input, false);
  };
  const observer = new MutationObserver((changes) => {
    if (
      changes.some(
        (change) =>
          (change.type === "attributes" && change.target !== panel) ||
          [...change.addedNodes, ...change.removedNodes].some(
            (node) =>
              node instanceof Element &&
              !(
                node instanceof HTMLElement &&
                node.dataset.authenticatorMenu !== undefined
              ),
          ),
      )
    )
      discover();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "id",
      "name",
      "placeholder",
      "aria-label",
      "aria-labelledby",
      "autocomplete",
      "inputmode",
      "maxlength",
      "disabled",
      "readonly",
      "hidden",
      "class",
      "style",
      "open",
    ],
  });
  discover();
  document.addEventListener("pointerdown", (event) => {
    if (
      panel &&
      event.target !== currentInput &&
      !event.composedPath().includes(panel)
    )
      close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
  document.addEventListener("scroll", () => place?.(), true);
  window.addEventListener("resize", () => place?.());
}
