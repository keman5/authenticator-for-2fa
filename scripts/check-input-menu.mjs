import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporary = await mkdtemp(join(tmpdir(), "authenticator-menu-"));
const sockets = [];
let child;
const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html");
  response.end(
    '<!doctype html><title>OTP test</title><label>Username<input id="user"></label><label>Verification code<input id="otp" autocomplete="one-time-code" inputmode="numeric" maxlength="6"></label><input id="other-otp" autocomplete="one-time-code" maxlength="6">',
  );
});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(action, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await action();
    if (result) return result;
    await pause(100);
  }
  throw Error(label);
}
async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  sockets.push(socket);
  await new Promise((resolve) =>
    socket.addEventListener("open", resolve, { once: true }),
  );
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const result = JSON.parse(data);
    const action = pending.get(result.id);
    if (!action) return;
    pending.delete(result.id);
    if (result.error) action.reject(Error(result.error.message));
    else action.resolve(result.result);
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const run = async (expression) => {
    const result = await call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    assert.ok(
      !result.exceptionDetails,
      JSON.stringify(result.exceptionDetails),
    );
    return result.result.value;
  };
  await call("Runtime.enable");
  return { call, run };
}
function findNode(node, predicate) {
  if (predicate(node)) return node;
  for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
}
try {
  const extension = join(temporary, "extension");
  await cp("dist/edge", extension, { recursive: true });
  const manifest = JSON.parse(
    await readFile(join(extension, "manifest.json"), "utf8"),
  );
  // The isolated headless fixture grants the optional hosts; production still
  // requests them from the user when the setting is enabled.
  manifest.host_permissions = manifest.optional_host_permissions;
  await writeFile(join(extension, "manifest.json"), JSON.stringify(manifest));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  child = spawn(
    process.env.EDGE_BINARY ??
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    [
      "--headless=new",
      `--user-data-dir=${join(temporary, "profile")}`,
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const port = await until(async () => {
    try {
      return (
        await readFile(join(temporary, "profile", "DevToolsActivePort"), "utf8")
      ).split("\n")[0];
    } catch {
      return null;
    }
  }, "Edge debugging port");
  const endpoint = `http://127.0.0.1:${port}`;
  const worker = await until(
    async () =>
      (
        await fetch(`${endpoint}/json/list`).then((result) => result.json())
      ).find(
        (target) =>
          target.type === "service_worker" &&
          target.url.endsWith("/assets/worker.js"),
      ),
    "extension service worker",
  );
  const background = await connect(worker);
  await until(
    () => background.run("typeof chrome !== 'undefined' && !!chrome.storage"),
    "worker extension context",
  );
  await background.run(
    'chrome.storage.local.set({\'keman5.authenticator.workspace.v2\':{"schema": 2, "records": {"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": {"id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "provider": "Example", "login": "alice@example.com", "secret": "JBSWY3DPEHPK3PXP", "site": "127.0.0.1", "mode": "totp", "hash": "SHA-1", "digits": 6, "interval": 30, "counter": 0, "position": 0, "changed": 1, "removed": false, "favorite": false}, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb": {"id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "provider": "Other", "login": "other@example.net", "secret": "JBSWY3DPEHPK3PXP", "site": "other.net", "mode": "totp", "hash": "SHA-1", "digits": 6, "interval": 30, "counter": 0, "position": 1, "changed": 1, "removed": false, "favorite": false}}, "preferences": {"locale": "en", "languageMode": "manual", "theme": "light", "conceal": true, "seconds": false, "paste": false, "matchSite": false, "showAll": true, "inputMenu": true}}})',
  );
  await until(
    () =>
      background.run(
        "chrome.scripting.getRegisteredContentScripts().then(s=>s.length===1)",
      ),
    "page menu registration",
  );
  const open = async (pageUrl) =>
    connect(
      await fetch(`${endpoint}/json/new?${encodeURIComponent(pageUrl)}`, {
        method: "PUT",
      }).then((result) => result.json()),
    );
  const page = await open(url);
  await until(
    () => page.run("!!document.querySelector('#otp')"),
    "sample OTP field",
  );
  await page.run("document.querySelector('#otp').focus()");
  const getAccountNode = async () =>
    findNode(
      (await page.call("DOM.getDocument", { depth: -1, pierce: true })).root,
      (node) => node.nodeName === "BUTTON",
    );
  const option = await until(getAccountNode, "matching account menu");
  assert.equal(await page.run("document.querySelector('#otp').value"), "");
  const object = await page.call("DOM.resolveNode", {
    backendNodeId: option.backendNodeId,
  });
  const label = await page.call("Runtime.callFunctionOn", {
    objectId: object.object.objectId,
    functionDeclaration: "function(){return this.textContent}",
    returnByValue: true,
  });
  assert.equal(label.result.value, "Example alice@example.com");
  await page.call("Runtime.callFunctionOn", {
    objectId: object.object.objectId,
    functionDeclaration: "function(){this.click()}",
  });
  await until(
    () => page.run("/^\\d{6}$/.test(document.querySelector('#otp').value)"),
    "safe OTP fill",
  );
  assert.equal(await page.run("document.querySelector('#user').value"), "");
  await page.run(
    "document.querySelector('#user').focus();document.querySelector('#otp').value='word';document.querySelector('#otp').focus()",
  );
  const retry = await until(getAccountNode, "refocused original field");
  const retryObject = await page.call("DOM.resolveNode", {
    backendNodeId: retry.backendNodeId,
  });
  await page.call("Runtime.callFunctionOn", {
    objectId: retryObject.object.objectId,
    functionDeclaration: "function(){this.click()}",
  });
  await pause(200);
  assert.equal(
    await page.run("document.querySelector('#other-otp').value"),
    "",
  );
  assert.equal(await page.run("document.querySelector('#otp').value"), "word");
  for (const id of [
    "googleCode",
    "googleAuthenticatorCode",
    "two_factor_code",
    "mfa",
    "passcode",
  ]) {
    await page.run(
      `document.body.innerHTML='<input id="${id}" inputmode="numeric" maxlength="6">';document.querySelector('input').focus()`,
    );
    const button = await until(getAccountNode, "OTP alias menu: " + id);
    const node = await page.call("DOM.resolveNode", {
      backendNodeId: button.backendNodeId,
    });
    await page.call("Runtime.callFunctionOn", {
      objectId: node.object.objectId,
      functionDeclaration: "function(){this.click()}",
    });
    await until(
      () => page.run("/^\\d{6}$/.test(document.querySelector('input').value)"),
      "alias filling: " + id,
    );
  }
  for (const id of [
    "otp_secret",
    "security_code",
    "authCode",
    "recoveryCode",
    "mfa_method",
    "googleAuthorizationCode",
    "googleCodeVerifier",
    "googleCouponCode",
    "notgoogleCode",
  ]) {
    await page.run(
      `document.body.innerHTML='<input id="${id}" inputmode="numeric" maxlength="6">';document.querySelector('input').focus()`,
    );
    await pause(100);
    assert.equal(await getAccountNode(), undefined, "No menu on " + id);
    assert.equal(await page.run("document.querySelector('input').value"), "");
  }
  await background.run(
    "chrome.storage.local.get('keman5.authenticator.workspace.v2').then(async data=>{const v=data['keman5.authenticator.workspace.v2'];v.preferences.inputMenu=false;await chrome.storage.local.set({'keman5.authenticator.workspace.v2':v})})",
  );
  await until(
    () =>
      background.run(
        "chrome.scripting.getRegisteredContentScripts().then(s=>s.length===0)",
      ),
    "disable unregisters page menu",
  );
  await page.run(
    "document.body.innerHTML='<input id=otp autocomplete=one-time-code>';document.querySelector('#otp').focus()",
  );
  await pause(200);
  assert.equal(await getAccountNode(), undefined);
  console.log(
    "PASS Edge: matched OTP menu, safe fill, preserved non-code content, recognized OTP aliases, rejected sensitive fields and permission cleanup.",
  );
} finally {
  for (const socket of sockets) socket.close();
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
  await new Promise((resolve) => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
