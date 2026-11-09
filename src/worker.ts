import { readWorkspace } from "./platform/repository";
import { canUseWorkspace } from "./platform/session";
import { getAccountPageRanking } from "./domain/site";
import { toAccount } from "./domain/view";
import { activeRecords } from "./domain/records";
import { codeFor } from "./domain/otp";
import { otpTime } from "./platform/time";
import { installInputMenu } from "./platform/inputMenu";
import { nativeTouchID, TouchIDError } from "./platform/touchID";
import { parseTransfer } from "./domain/transfer";
import { insertRecords, InputError } from "./domain/records";
import { scanImage } from "./domain/qr";
import { transaction } from "./platform/repository";

chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
  if (!message || typeof message !== "object") return;
  const request = message as Record<string, unknown>;
  if (
    ![
      "context",
      "fill",
      "scan",
      "capture",
      "touch-id",
      "scan-cancel",
      "scan-failed",
    ].includes(String(request.kind))
  )
    return;
  void handle(request, sender)
    .then((value) => reply({ ok: true, value }))
    .catch((error: unknown) =>
      reply({
        ok: false,
        error: error instanceof Error ? error.message : "Request failed",
      }),
    );
  return true;
});
async function handle(
  request: Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (sender.id !== chrome.runtime.id) throw new InputError("invalid");
  if (request.kind === "scan-cancel" || request.kind === "scan-failed") {
    if (sender.tab?.windowId === undefined) throw new InputError("invalid");
    const cancelled = request.kind === "scan-cancel";
    void chrome.runtime
      .sendMessage({
        type: "page-scan:completed",
        windowId: sender.tab.windowId,
        ok: false,
        cancelled,
        message: cancelled
          ? "Page scan cancelled."
          : typeof request.error === "string"
            ? request.error.slice(0, 512)
            : "Page scan failed.",
      })
      .catch(() => {});
    return true;
  }
  if (request.kind === "capture") return capture(request, sender);
  if (
    sender.tab &&
    sender.url?.split(/[?#]/)[0] !== chrome.runtime.getURL("index.html")
  )
    throw new InputError("invalid");
  if (request.kind === "touch-id") {
    if (
      !["status", "authenticate"].includes(String(request.action)) ||
      (request.action === "authenticate" &&
        (typeof request.reason !== "string" ||
          request.reason.length < 1 ||
          request.reason.length > 256))
    )
      throw new TouchIDError("failed");
    await nativeTouchID(
      request.action as "status" | "authenticate",
      typeof request.reason === "string" ? request.reason : undefined,
    );
    return true;
  }
  if (
    ["fill", "scan"].includes(String(request.kind)) &&
    !(await canUseWorkspace(await readWorkspace()))
  )
    throw new InputError("unavailable");
  const source =
    typeof request.source === "number" &&
    Number.isSafeInteger(request.source) &&
    request.source >= 0
      ? request.source
      : undefined;
  const [tab] = await chrome.tabs.query(
    source === undefined
      ? { active: true, lastFocusedWindow: true }
      : { active: true, windowId: source },
  );
  if (request.kind === "context") {
    if (!tab?.url) return { hostname: "" };
    try {
      const url = new URL(tab.url);
      return { hostname: /^https?:$/.test(url.protocol) ? url.hostname : "" };
    } catch {
      return { hostname: "" };
    }
  }
  if (!tab?.id || !/^https?:/.test(tab.url ?? ""))
    throw new InputError("unavailable");
  if (
    request.kind === "fill" &&
    (typeof request.code !== "string" ||
      !/^([0-9]{6,8}|[23456789BCDFGHJKMNPQRTVWXY]{5})$/.test(request.code))
  )
    throw new InputError("invalid");
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["assets/injected.js"],
  });
  if (!(await canUseWorkspace(await readWorkspace())))
    throw new InputError("unavailable");
  return chrome.tabs.sendMessage(tab.id, {
    kind: request.kind,
    code: request.code,
  });
}
async function capture(
  request: Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (sender.tab?.windowId === undefined) throw new InputError("invalid");
  if (!(await canUseWorkspace(await readWorkspace())))
    throw new InputError("unavailable");
  const x = request.x,
    y = request.y,
    width = request.width,
    height = request.height,
    viewport = request.viewport;
  if (
    ![x, y, width, height, viewport].every(
      (v) => typeof v === "number" && Number.isFinite(v),
    ) ||
    Number(x) < 0 ||
    Number(y) < 0 ||
    Number(width) < 4 ||
    Number(height) < 4 ||
    Number(viewport) < 1
  )
    throw new InputError("invalid");
  let focus: { x: number; y: number } | undefined;
  if (request.focus !== undefined) {
    const point = request.focus as { x?: unknown; y?: unknown } | null;
    if (
      !point ||
      typeof point.x !== "number" ||
      typeof point.y !== "number" ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.x < 0 ||
      point.y < 0 ||
      point.x > Number(width) ||
      point.y > Number(height)
    )
      throw new InputError("invalid");
    focus = { x: point.x, y: point.y };
  }
  const [active] = await chrome.tabs.query({
    active: true,
    windowId: sender.tab.windowId,
  });
  if (active?.id !== sender.tab.id) throw new InputError("stale");
  const shot = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {
    format: "png",
  });
  const blob = await (await fetch(shot)).blob();
  const bitmap = await createImageBitmap(blob);
  let image: Blob;
  let scale = 1;
  try {
    scale = bitmap.width / Number(viewport);
    const w = Math.round(Number(width) * scale),
      h = Math.round(Number(height) * scale);
    if (
      w * h > 16_000_000 ||
      Number(x) * scale + w > bitmap.width + 1 ||
      Number(y) * scale + h > bitmap.height + 1
    )
      throw new InputError("invalid");
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new InputError("unavailable");
    ctx.drawImage(
      bitmap,
      Number(x) * scale,
      Number(y) * scale,
      w,
      h,
      0,
      0,
      w,
      h,
    );
    image = await canvas.convertToBlob({ type: "image/png" });
  } finally {
    bitmap.close();
  }
  const texts = await scanImage(
    image,
    focus ? { x: focus.x * scale, y: focus.y * scale } : undefined,
  );
  const incoming = (await Promise.all(texts.map(parseTransfer))).flat();
  const { result } = await transaction(async (space) => {
    if (!(await canUseWorkspace(space))) throw new InputError("unavailable");
    return insertRecords(space, incoming);
  });
  void chrome.runtime
    .sendMessage({
      type: "page-scan:completed",
      windowId: sender.tab.windowId,
      ok: true,
      imported: result.added,
      message: `${result.added} account${result.added === 1 ? "" : "s"} imported.`,
    })
    .catch(() => {});
  return result;
}

chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
  if (!message || typeof message !== "object") return;
  const value = message as Record<string, unknown>;
  if (
    ![
      "get-active-page-context",
      "paste-code",
      "start-page-scan",
      "input-menu:accounts",
      "input-menu:code",
    ].includes(String(value.type))
  )
    return;
  void (async () => {
    if (sender.id !== chrome.runtime.id) throw new InputError("invalid");
    const pageMenu = String(value.type).startsWith("input-menu:");
    if (
      !pageMenu &&
      sender.url?.split(/[?#]/)[0] !== chrome.runtime.getURL("index.html")
    )
      throw new InputError("invalid");
    if (value.type === "get-active-page-context")
      return {
        ok: true,
        pageContext: await handle(
          { kind: "context", source: value.windowId },
          sender,
        ),
      };
    const workspace = await readWorkspace();
    if (!(await canUseWorkspace(workspace)))
      throw new InputError("unavailable");
    if (pageMenu) {
      if (
        sender.frameId !== 0 ||
        sender.tab?.id === undefined ||
        !sender.url ||
        !/^https?:/.test(sender.url) ||
        !workspace.preferences.inputMenu ||
        !(await chrome.permissions.contains({
          origins: ["http://*/*", "https://*/*"],
        }))
      )
        throw new InputError("unavailable");
      const ranking = getAccountPageRanking(
        activeRecords(workspace).map(toAccount),
        { hostname: new URL(sender.url).hostname },
      );
      const accounts = ranking.accounts.filter((item) =>
        ranking.suggestedAccountIds.has(item.id),
      );
      if (value.type === "input-menu:accounts")
        return {
          ok: true,
          accounts: accounts.map(({ id, issuer, label }) => ({
            id,
            issuer,
            label,
          })),
        };
      const selected = accounts.find((item) => item.id === value.accountId);
      if (!selected) throw new InputError("invalid");
      const code = await codeFor(workspace.records[selected.id]!, await otpTime());
      const current = await readWorkspace();
      if (
        !current.preferences.inputMenu ||
        !(await canUseWorkspace(current)) ||
        current.gate?.proof !== workspace.gate?.proof ||
        current.gate?.lockedAt !== workspace.gate?.lockedAt ||
        current.records[selected.id]?.removed ||
        current.records[selected.id]?.changed !==
          workspace.records[selected.id]?.changed
      )
        throw new InputError("stale");
      return { ok: true, code };
    }
    if (value.type === "paste-code")
      return {
        ok: true,
        pasted: await handle(
          { kind: "fill", source: value.windowId, code: value.code },
          sender,
        ),
      };
    await handle({ kind: "scan", source: value.windowId }, sender);
    return { ok: true };
  })()
    .then(reply)
    .catch((error: unknown) =>
      reply({
        ok: false,
        error: error instanceof Error ? error.message : "Request failed",
      }),
    );
  return true;
});
installInputMenu();
chrome.tabs.onActivated?.addListener((info) => {
  void chrome.runtime
    .sendMessage({
      type: "active-page-context-changed",
      windowId: info.windowId,
    })
    .catch(() => {});
});
chrome.tabs.onUpdated?.addListener((_id, change, tab) => {
  if (change.url && tab.active)
    void chrome.runtime
      .sendMessage({
        type: "active-page-context-changed",
        windowId: tab.windowId,
      })
      .catch(() => {});
});
