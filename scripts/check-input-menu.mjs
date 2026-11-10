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
      (node) =>
        node.nodeName === "BUTTON" &&
        node.attributes?.includes("data-authenticator-account"),
    );
  const option = await until(getAccountNode, "matching account menu");
  const logo = findNode(
    (await page.call("DOM.getDocument", { depth: -1, pierce: true })).root,
    (node) =>
      node.nodeName.toLowerCase() === "svg" &&
      node.attributes?.includes("0 0 48 48"),
  );
  assert.ok(logo, "page enhancement uses the product countdown logo");
  const logoObject = await page.call("DOM.resolveNode", {
    backendNodeId: logo.backendNodeId,
  });
  const countdown = async () =>
    (
      await page.call("Runtime.callFunctionOn", {
        objectId: logoObject.object.objectId,
        functionDeclaration:
          "function(){return Array.from(this.querySelectorAll('circle[stroke-dasharray]'),arc=>arc.getAttribute('stroke-dasharray'))}",
        returnByValue: true,
      })
    ).result.value;
  const initialCountdown = await countdown();
  assert.equal(initialCountdown.length, 4);
  await pause(300);
  assert.notDeepEqual(
    await countdown(),
    initialCountdown,
    "logo countdown advances in the actual injected script",
  );
  const preview = await page.call("Page.captureScreenshot", { format: "png" });
  await writeFile(
    "artifacts/page-enhancement-preview.png",
    Buffer.from(preview.data, "base64"),
  );
  assert.equal(await page.run("document.querySelector('#otp').value"), "");
  const object = await page.call("DOM.resolveNode", {
    backendNodeId: option.backendNodeId,
  });
  const label = await page.call("Runtime.callFunctionOn", {
    objectId: object.object.objectId,
    functionDeclaration:
      "function(){return this.querySelector('.label').textContent}",
    returnByValue: true,
  });
  assert.equal(label.result.value, "alice@example.com");
  const readCode = async () =>
    (
      await page.call("Runtime.callFunctionOn", {
        objectId: object.object.objectId,
        functionDeclaration:
          "function(){return this.querySelector('[data-authenticator-code]').textContent}",
        returnByValue: true,
      })
    ).result.value;
  assert.equal(await readCode(), "******");
  const entry = findNode(
    (await page.call("DOM.getDocument", { depth: -1, pierce: true })).root,
    (node) =>
      node.nodeName === "BUTTON" &&
      node.attributes?.includes("data-authenticator-trigger"),
  );
  const entryObject = await page.call("DOM.resolveNode", {
    backendNodeId: entry.backendNodeId,
  });
  const entryBounds = (
    await page.call("Runtime.callFunctionOn", {
      objectId: entryObject.object.objectId,
      functionDeclaration:
        "function(){const r=this.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}}",
      returnByValue: true,
    })
  ).result.value;
  await page.call("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    ...entryBounds,
  });
  const optionBounds = (
    await page.call("Runtime.callFunctionOn", {
      objectId: object.object.objectId,
      functionDeclaration:
        "function(){const r=this.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,width:r.width}}",
      returnByValue: true,
    })
  ).result.value;
  assert.ok(optionBounds.width > 0, "hover opens the account dropdown");
  await page.call("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: optionBounds.x,
    y: optionBounds.y,
  });
  await until(
    async () => /^\d{6}$/.test(await readCode()),
    "hover reveals the selected code",
  );
  const hoverPreview = await page.call("Page.captureScreenshot", {
    format: "png",
  });
  await writeFile(
    "artifacts/page-enhancement-preview.png",
    Buffer.from(hoverPreview.data, "base64"),
  );
  await page.call("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    ...entryBounds,
  });
  await until(
    async () => (await readCode()) === "******",
    "leaving the code masks it again",
  );
  assert.equal(await page.run("document.querySelector('#otp').value"), "");
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
  // A two-factor settings dialog may render after the content script and
  // identify its generic code input only through the associated label.
  await page.run(
    `document.body.innerHTML='<button id="settings">Settings</button>';document.querySelector('#settings').focus();document.body.insertAdjacentHTML('beforeend','<dialog><button autofocus>Close</button><h2>Two-factor authentication</h2><label for="code">Authentication code</label><input id="code" inputmode="numeric" maxlength="6"></dialog>');document.querySelector('dialog').showModal()`,
  );
  const trigger = await until(
    async () =>
      findNode(
        (await page.call("DOM.getDocument", { depth: -1, pierce: true })).root,
        (node) =>
          node.nodeName === "BUTTON" &&
          node.attributes?.includes("data-authenticator-trigger"),
      ),
    "dynamic two-factor dialog entry icon",
  );
  assert.equal(await page.run("document.querySelector('#code').value"), "");
  assert.equal(
    await page.run(
      "document.activeElement === document.querySelector('#code')",
    ),
    false,
    "the entry icon must appear before the code field is focused",
  );
  const triggerObject = await page.call("DOM.resolveNode", {
    backendNodeId: trigger.backendNodeId,
  });
  const bounds = await page.call("Runtime.callFunctionOn", {
    objectId: triggerObject.object.objectId,
    functionDeclaration:
      "function(){const r=this.getBoundingClientRect();return {left:r.left,top:r.top}}",
    returnByValue: true,
  });
  const inputBounds = await page.run(
    "(()=>{const r=document.querySelector('#code').getBoundingClientRect();return {right:r.right,top:r.top}})()",
  );
  assert.ok(Math.abs(bounds.result.value.left - (inputBounds.right + 4)) <= 1);
  assert.ok(
    Math.abs(bounds.result.value.top - Math.max(0, inputBounds.top - 28)) <= 1,
  );
  const clickAt = async (x, y) => {
    await page.call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    await page.call("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
  };
  await page.call("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: bounds.result.value.left + 14,
    y: bounds.result.value.top + 12,
  });
  assert.equal(
    await page.run("document.querySelector('#code').value"),
    "",
    "opening the account list must not fill a code",
  );
  const dialogAccount = await until(
    getAccountNode,
    "two-factor settings account option",
  );
  const dialogObject = await page.call("DOM.resolveNode", {
    backendNodeId: dialogAccount.backendNodeId,
  });
  const accountBounds = await page.call("Runtime.callFunctionOn", {
    objectId: dialogObject.object.objectId,
    functionDeclaration:
      "function(){const r=this.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height}}",
    returnByValue: true,
  });
  assert.ok(accountBounds.result.value.width > 0);
  assert.ok(accountBounds.result.value.height > 0);
  await clickAt(accountBounds.result.value.x, accountBounds.result.value.y);
  await until(
    () => page.run("/^\\d{6}$/.test(document.querySelector('#code').value)"),
    "labelled code filling",
  );
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
    "PASS Edge: matched OTP menu, dynamic two-factor dialog upper-right icon, labelled code fill, preserved non-code content, recognized OTP aliases, rejected sensitive fields and permission cleanup.",
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
