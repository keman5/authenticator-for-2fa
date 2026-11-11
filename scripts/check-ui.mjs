import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import QRCode from "qrcode";
const browser =
  process.env.EDGE_BINARY ??
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
const profile = await mkdtemp(join(tmpdir(), "authenticator-ui-"));
let child = launch();
function launch() {
  return spawn(
    browser,
    [
      "--headless=new",
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      `--disable-extensions-except=${resolve("dist/edge")}`,
      `--load-extension=${resolve("dist/edge")}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(work, label) {
  for (let i = 0; i < 100; i++) {
    const result = await work();
    if (result) return result;
    await pause(100);
  }
  throw new Error("Timed out: " + label);
}
class CDP {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve) =>
      this.socket.addEventListener("open", resolve, { once: true }),
    );
    this.socket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      const pair = this.pending.get(data.id);
      if (pair) {
        this.pending.delete(data.id);
        if (data.error) pair.reject(new Error(data.error.message));
        else pair.resolve(data.result);
      }
    });
  }
  async call(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  close() {
    this.socket.close();
  }
}
let worker, page, endpoint, root;
const store = "keman5.authenticator.workspace.v2";
const state = () =>
  worker.evaluate(
    `chrome.storage.local.get('${store}').then(x=>x['${store}'])`,
  );
async function attach() {
  const port = await until(async () => {
    try {
      return (
        await readFile(join(profile, "DevToolsActivePort"), "utf8")
      ).split("\n")[0];
    } catch {
      return null;
    }
  }, "debug port");
  endpoint = `http://127.0.0.1:${port}`;
  const target = await until(
    async () =>
      (await fetch(endpoint + "/json/list").then((r) => r.json())).find(
        (t) =>
          t.type === "service_worker" && t.url.endsWith("/assets/worker.js"),
      ),
    "worker",
  );
  root = target.url.slice(0, target.url.indexOf("/assets/"));
  worker = new CDP(target.webSocketDebuggerUrl);
  await worker.call("Runtime.enable");
  await until(
    () =>
      worker.evaluate(
        "typeof chrome!=='undefined'&&Boolean(chrome.runtime?.id)",
      ),
    "worker context",
  );
}
async function open(url = root + "/index.html") {
  const target = await fetch(
    endpoint + "/json/new?" + encodeURIComponent(url),
    { method: "PUT" },
  ).then((r) => r.json());
  const tab = new CDP(target.webSocketDebuggerUrl);
  await tab.call("Page.enable");
  return tab;
}
const click = (label) =>
  page.evaluate(
    `(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing button '+${JSON.stringify(label)});b.click();})()`,
  );
const row = (label) =>
  page.evaluate(
    `(()=>{const b=Array.from(document.querySelectorAll('.list-row')).find(b=>b.querySelector('b')?.textContent===${JSON.stringify(label)});if(!b)throw Error('Missing row '+${JSON.stringify(label)});b.click();})()`,
  );
const field = (label, value) =>
  page.evaluate(
    `(()=>{const label=Array.from(document.querySelectorAll('label')).find(l=>l.textContent.trim()===${JSON.stringify(label)});const input=document.getElementById(label?.htmlFor)||label?.querySelector('input,textarea');if(!input)throw Error('Missing field '+${JSON.stringify(label)});Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
const codes = () => page.evaluate("document.querySelector('.code')!==null");
const locked = () =>
  page.evaluate(
    "document.querySelector('input[autocomplete=current-password]')!==null",
  );
const metrics = (height) =>
  page.call("Emulation.setDeviceMetricsOverride", {
    width: 370,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
async function restart() {
  page?.close();
  worker?.close();
  page = worker = undefined;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await exited;
  await rm(join(profile, "DevToolsActivePort"), { force: true });
  child = launch();
  await attach();
}
try {
  await attach();
  await worker.evaluate(
    `chrome.storage.local.set({'${store}':{schema:2,records:{},preferences:{locale:'en',languageMode:'manual',theme:'light',conceal:false,seconds:true,paste:false,matchSite:false}}})`,
  );
  page = await open();
  await metrics(755);
  await until(
    () => page.evaluate("document.querySelector('.p-nav')!==null"),
    "React UI",
  );
  for (const toolbar of [false, true])
    for (const height of [400, 600, 680, 687, 700, 720, 755, 800]) {
      await metrics(height);
      await page.evaluate(
        `document.documentElement.classList.toggle('toolbar-popup',${toolbar});document.documentElement.classList.toggle('toolbar-popup-sized',${toolbar})`,
      );
      const bounds = await page.evaluate(
        "(()=>{const n=document.querySelector('.p-nav'),r=n.getBoundingClientRect(),s=getComputedStyle(n);return {height:r.height,bottom:r.bottom,width:document.documentElement.scrollWidth,paddingTop:s.paddingTop,paddingBottom:s.paddingBottom,buttonHeight:n.querySelector('button').getBoundingClientRect().height,iconHeight:n.querySelector('svg').getBoundingClientRect().height}})()",
      );
      assert.equal(bounds.height, 44);
      assert.equal(bounds.paddingTop, "6px");
      assert.equal(bounds.paddingBottom, "6px");
      assert.equal(bounds.buttonHeight, 44);
      assert.equal(bounds.iconHeight, 18);
      assert.equal(bounds.bottom, height);
      assert.ok(bounds.width <= 370);
    }
  await metrics(755);
  await page.evaluate(
    "document.documentElement.classList.remove('toolbar-popup','toolbar-popup-sized')",
  );
  assert.equal(
    await page.evaluate(
      "document.querySelector('.brand-logo svg').getBoundingClientRect().width",
    ),
    34,
  );
  await click("Add account");
  await until(
    () =>
      page.evaluate(
        "document.querySelector('.scan-way.active')?.textContent==='Screenshot'",
      ),
    "default screenshot",
  );
  await click("Manual entry");
  await until(
    () => page.evaluate("document.getElementById('account-label')!==null"),
    "manual form",
  );
  await field("Name (site or service)", "Example");
  await field("Account", "alice@example.com");
  await field("Secret (Base32)", "JBSWY3DPEHPK3PXP");
  await click("Save account");
  await until(codes, "account added");
  await until(
    () => page.evaluate("document.querySelectorAll('.confetti i').length===140"),
    "success confetti",
  );
  assert.equal(
    await page.evaluate(
      "getComputedStyle(document.querySelector('.confetti')).pointerEvents",
    ),
    "none",
  );
  const startedAt = Date.now();
  await mkdir("artifacts", { recursive: true });
  const samples = [];
  for (const time of [300, 750, 1400, 2800, 4200]) {
    await pause(Math.max(0, time - (Date.now() - startedAt)));
    samples.push(await page.evaluate(`(()=>{
      const points = [...document.querySelectorAll('.confetti i')].map(p => new DOMMatrixReadOnly(getComputedStyle(p).transform));
      return { count: points.length, y: points.reduce((sum, p) => sum + p.m42, 0) / points.length,
        spread: Math.max(...points.map(p => p.m41)) - Math.min(...points.map(p => p.m41)) };
    })()`));
    if (time === 1400)
      await writeFile("artifacts/account-added-confetti.png", Buffer.from(
        (await page.call("Page.captureScreenshot", { format: "png" })).data, "base64",
      ));
  }
  assert.ok(samples[1].y < samples[0].y, "confetti rises");
  assert.ok(samples[3].y > samples[2].y, "confetti falls");
  assert.ok(samples[2].spread >= 185, "confetti spreads across the panel");
  assert.ok(samples[4].count > 0, "confetti finishes naturally");
  assert.equal(Object.keys((await state()).records).length, 1);
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/accounts.png",
    Buffer.from(
      (await page.call("Page.captureScreenshot", { format: "png" })).data,
      "base64",
    ),
  );
  await click("Data");
  const qrPath = join(profile, "account.png");
  await writeFile(
    qrPath,
    await QRCode.toBuffer(
      "otpauth://totp/Example:bob?secret=JBSWY3DPEHPK3PXP&issuer=Example",
    ),
  );
  await until(
    () => page.evaluate("document.querySelector('input[type=file]')!==null"),
    "file import",
  );
  const doc = await page.call("DOM.getDocument"),
    input = await page.call("DOM.querySelector", {
      nodeId: doc.root.nodeId,
      selector: "input[type=file]",
    });
  await page.call("DOM.setFileInputFiles", {
    nodeId: input.nodeId,
    files: [qrPath],
  });
  await until(
    async () => Object.keys((await state()).records).length === 2,
    "real PNG import and bundled WASM",
  );
  await until(
    () => page.evaluate("document.querySelector('.confetti')===null"),
    "confetti cleanup",
  );
  await click("Settings");
  await row("UI password");
  await field("New password", "1");
  await field("Confirm password", "1");
  await click("Save password");
  await until(
    () =>
      page.evaluate(
        "Array.from(document.querySelectorAll('.list-row b')).some(b=>b.textContent==='Passkey & shortcuts')",
      ),
    "saved one character password",
  );
  await row("Passkey & shortcuts");
  assert.equal(
    await page.evaluate(
      "document.body.innerText.includes('Touch ID')||document.body.innerText.includes('skip password')",
    ),
    false,
  );
  await click("Shortcut settings");
  await until(
    async () =>
      (await fetch(endpoint + "/json/list").then((r) => r.json())).some(
        (t) =>
          t.type === "page" &&
          /^(edge|chrome):\/\/extensions\/shortcuts/.test(t.url),
      ),
    "real shortcut settings navigation",
  );
  // Simulate an upgrade from a version with bypass enabled.
  await worker.evaluate(
    `chrome.storage.local.get('${store}').then(x=>{x['${store}'].gate.quick=true;delete x['${store}'].gate.unlockedAt;return chrome.storage.local.set(x)})`,
  );
  await page.call("Page.navigate", { url: root + "/index.html?entry=quick" });
  await until(locked, "legacy direct entry requires password");
  assert.equal(await codes(), false);
  await field("Password", "wrong");
  await click("Unlock");
  await until(
    () => page.evaluate("document.querySelector('[role=alert]')!==null"),
    "wrong password error",
  );
  assert.equal(await codes(), false);
  await restart();
  page = await open(root + "/index.html?entry=quick");
  await until(locked, "legacy bypass stays locked after restart");
  await field("Password", "1");
  await click("Unlock");
  await until(codes, "one character unlock");
  await click("Settings");
  await click("Auto-lock");
  await pause(150);
  await click("days");
  assert.equal((await state()).gate.lockAfter, 0);
  await click("7 days");
  await until(
    async () => (await state()).gate.lockAfter === 604800,
    "days duration selected",
  );
  await click("Auto-lock");
  await pause(100);
  assert.equal(
    await page.evaluate(
      "Array.from(document.querySelectorAll('.dd-menu .seg button')).find(b=>b.textContent==='days')?.getAttribute('aria-pressed')",
    ),
    "true",
  );
  await click("minutes");
  await click("1 minutes");
  await until(
    async () => (await state()).gate.lockAfter === 60,
    "timed setting",
  );
  const stamp = (await state()).gate.unlockedAt;
  await page.call("Page.navigate", { url: root + "/index.html?entry=quick" });
  await until(codes, "authenticated timed reopening");
  assert.equal((await state()).gate.unlockedAt, stamp);
  await restart();
  page = await open();
  await until(codes, "authenticated deadline persists across browser restart");
  assert.equal((await state()).gate.unlockedAt, stamp);
  const setClock = (offset) =>
    page.evaluate(`globalThis.originalNow ??= Date.now; Date.now=()=>globalThis.originalNow()+${offset}`);
  await setClock(15000);
  await page.call("Input.dispatchMouseEvent", {
    type: "mousePressed", button: "left", buttons: 1, clickCount: 1, x: 5, y: 5,
  });
  await until(async () => (await state()).gate.unlockedAt > stamp, "mouse press renews idle deadline");
  await setClock(65000);
  await until(async () => (await state()).gate.unlockedAt >= stamp + 65000, "held mouse renews idle deadline");
  assert.equal(await codes(), true);
  await page.call("Input.dispatchMouseEvent", {
    type: "mouseReleased", button: "left", clickCount: 1, x: 5, y: 5,
  });
  await setClock(126000);
  await until(locked, "open panel expires after pointer release and inactivity");
  await page.evaluate("Date.now=globalThis.originalNow");
  await field("Password", "1");
  await click("Unlock");
  await until(codes, "fresh password restarts deadline");
  await click("Settings");
  await click("Auto-lock");
  await pause(100);
  await click("Never");
  await until(
    async () => (await state()).gate.lockAfter === -1,
    "never setting",
  );
  await page.call("Page.reload");
  await until(codes, "permanent authenticated entry");
  await click("Lock");
  await until(locked, "explicit lock overrides forever");
  await page.call("Page.reload");
  await until(locked, "explicit lock survives reload");
  console.log(
    "PASS actual headless Edge: React UI, real PNG/WASM import, 370px layout at 8 heights, 34px header icon, one-character password, rejected legacy bypass URLs, shortcut settings navigation, grouped auto-lock selection, restart, idle locking after pointer release.",
  );
} catch (error) {
  if (page)
    try {
      console.error(await page.evaluate("document.body.innerText"));
    } catch {}
  throw error;
} finally {
  page?.close();
  worker?.close();
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
  }
  await rm(profile, { recursive: true, force: true });
}
