import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  rm,
  cp,
  readdir,
} from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";

// Capture only public dummy credentials in a disposable, headless local browser.
const output = "artifacts/store";
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const { version: packageVersion, extensionVersion } = JSON.parse(
  await readFile("package.json", "utf8"),
);
const version = extensionVersion ?? packageVersion;
const manifest = JSON.parse(await readFile("dist/edge/manifest.json", "utf8"));
if (manifest.version !== version)
  throw new Error("Build the current version first.");
for (const size of [128, 300, 512, 1024])
  await sharp("assets/brand/icons/authenticator-2fa-icon.svg", {
    density: (72 * size) / 128,
  })
    .resize(size, size)
    .png()
    .toFile(`${output}/icon-${size}.png`);

const profile = await mkdtemp(join(tmpdir(), "authenticator-store-"));
const child = spawn(
  process.env.EDGE_BINARY ??
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  [
    "--headless=new",
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    `--disable-extensions-except=${resolve("dist/edge")}`,
    `--load-extension=${resolve("dist/edge")}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);
let launchError;
child.on("error", (error) => {
  launchError = error;
});
const exited = once(child, "exit").catch(() => {});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(work, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (launchError) throw launchError;
    const result = await work();
    if (result) return result;
    await pause(100);
  }
  throw new Error(`Timed out: ${label}`);
}
class CDP {
  id = 0;
  pending = new Map();
  constructor(url) {
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const reply = JSON.parse(event.data),
        pending = this.pending.get(reply.id);
      if (!pending) return;
      this.pending.delete(reply.id);
      if (reply.error) pending.reject(new Error(reply.error.message));
      else pending.resolve(reply.result);
    });
  }
  async call(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
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
}
const clients = [];
try {
  const port = await until(async () => {
    try {
      return (
        await readFile(join(profile, "DevToolsActivePort"), "utf8")
      ).split("\n")[0];
    } catch {
      return undefined;
    }
  }, "browser launch");
  const endpoint = `http://127.0.0.1:${port}`;
  const target = await until(
    async () =>
      (await fetch(`${endpoint}/json/list`).then((r) => r.json())).find(
        (t) =>
          t.type === "service_worker" && t.url.endsWith("/assets/worker.js"),
      ),
    "extension worker",
  );
  const worker = new CDP(target.webSocketDebuggerUrl);
  clients.push(worker);
  await worker.call("Runtime.enable");
  await until(
    () =>
      worker.evaluate(
        "typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)",
      ),
    "extension worker context",
  );
  const root = target.url.slice(0, target.url.indexOf("/assets/"));
  for (const locale of ["en", "zh-CN"]) {
    const records = Object.fromEntries(
      ["Example Mail", "Demo Workspace", "Sample Cloud"].map(
        (provider, index) => {
          const id = String(index + 1).repeat(64);
          return [
            id,
            {
              id,
              provider,
              login: "demo@example.invalid",
              secret: "JBSWY3DPEHPK3PXP",
              mode: "totp",
              hash: "SHA-1",
              digits: 6,
              interval: 30,
              counter: 0,
              site: "example.invalid",
              position: index,
              changed: 1,
              removed: false,
              favorite: index === 0,
            },
          ];
        },
      ),
    );
    const workspace = {
      schema: 2,
      records,
      preferences: {
        locale: locale === "zh-CN" ? "zh" : locale,
        languageMode: "manual",
        theme: "light",
        conceal: false,
        seconds: true,
        paste: false,
        matchSite: false,
        showAll: true,
        sortMode: "manual",
      },
    };
    await worker.evaluate(
      `chrome.storage.local.set(${JSON.stringify({ "keman5.authenticator.workspace.v2": workspace })})`,
    );
    const pageTarget = await fetch(
      `${endpoint}/json/new?${encodeURIComponent(root + "/index.html")}`,
      { method: "PUT" },
    ).then((r) => r.json());
    const page = new CDP(pageTarget.webSocketDebuggerUrl);
    clients.push(page);
    await page.call("Page.enable");
    await page.call("Emulation.setDeviceMetricsOverride", {
      width: 370,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page.call("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    await until(
      () =>
        page.evaluate(
          "document.querySelectorAll('.code').length === 3 && document.querySelectorAll('.p-nav button').length === 3",
        ),
      "demo accounts",
    );
    await page.evaluate("document.fonts.ready.then(()=>true)");
    await mkdir(`${output}/${locale}`, { recursive: true });
    for (const [index, name] of ["accounts", "data", "settings"].entries()) {
      await page.evaluate(
        `document.querySelectorAll('.p-nav button')[${index}].click()`,
      );
      await until(
        () =>
          page.evaluate(
            `document.querySelectorAll('.p-nav button')[${index}].getAttribute('aria-current') === 'page'`,
          ),
        name,
      );
      await page.evaluate(
        "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
      );
      const { data } = await page.call("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      });
      const screenshot = Buffer.from(data, "base64");
      const dimensions = await sharp(screenshot).metadata();
      if (dimensions.width !== 370 || dimensions.height !== 720)
        throw new Error("Unexpected capture size");
      await sharp({
        create: {
          width: 1280,
          height: 800,
          channels: 3,
          background: "#f3f4f6",
        },
      })
        .composite([{ input: screenshot, gravity: "centre" }])
        .png()
        .toFile(`${output}/${locale}/${name}-1280x800.png`);
      if (name === "accounts")
        await sharp({
          create: {
            width: 612,
            height: 408,
            channels: 3,
            background: "#ffffff",
          },
        })
          .composite([
            {
              input: await sharp(screenshot).resize({ height: 384 }).toBuffer(),
              gravity: "centre",
            },
          ])
          .png()
          .toFile(`${output}/${locale}/accounts-612x408.png`);
    }
    await fetch(`${endpoint}/json/close/${pageTarget.id}`);
    page.socket.close();
  }
  for (const file of [
    "PRIVACY.md",
    "PRIVACY.zh-CN.md",
    "SUPPORT.md",
    "LICENSE",
  ])
    await cp(file, join(output, file));
  await cp("docs/store", join(output, "docs/store"), { recursive: true });
  for (const target of ["firefox", "edge"]) {
    const folder = join(output, target);
    await mkdir(folder, { recursive: true });
    const targetManifest = JSON.parse(
      await readFile(`dist/${target}/manifest.json`, "utf8"),
    );
    if (targetManifest.version !== version)
      throw new Error(`${target}: stale build`);
    await cp(
      `artifacts/authenticator-workspace-${version}-${target}.zip`,
      join(folder, "extension.zip"),
    );
    if (target === "firefox") {
      if (
        targetManifest.browser_specific_settings.gecko.id !==
        "authenticator-for-2fa@macseek.cc"
      )
        throw new Error("Unexpected Firefox submission ID");
      await cp(
        `artifacts/authenticator-workspace-${version}-source.zip`,
        join(folder, "source.zip"),
      );
    }
    await cp(`${output}/icon-128.png`, join(folder, "icon-128.png"));
    await cp(`${output}/icon-300.png`, join(folder, "logo-300.png"));
    for (const [locale, copyFile] of [
      ["en", "listing.en.md"],
      ["zh-CN", "listing.zh-CN.md"],
    ]) {
      const copy = await readFile(`docs/store/${copyFile}`, "utf8");
      const sections = copy
        .split(/^## /m)
        .slice(1)
        .map((section) => {
          const end = section.indexOf("\n");
          return [section.slice(0, end), section.slice(end + 1).trim()];
        });
      const field = (pattern) => {
        const section = sections.find(([title]) => pattern.test(title));
        if (!section)
          throw new Error(`Missing listing field ${pattern}: ${locale}`);
        return section[1];
      };
      const listing = {
        name: field(/^(Name|名称)$/),
        summary: field(/^(Short description|简短描述)$/),
        description: field(/^(Full description|完整描述)/),
        keywords: field(/^(Search terms|搜索词)/).split(","),
        supportEmail: "support@macseek.cc",
        homepageURL: targetManifest.homepage_url,
        privacyPolicyURL:
          "https://github.com/keman5/authenticator-for-2fa/blob/main/PRIVACY.md",
        supportURL:
          "https://github.com/keman5/authenticator-for-2fa/blob/main/SUPPORT.md",
      };
      if (
        listing.name.length > 50 ||
        listing.summary.length > 132 ||
        listing.description.length < 250 ||
        listing.description.length > 10000
      )
        throw new Error(`Listing field too long: ${locale}`);
      await writeFile(
        join(folder, `listing.${locale}.json`),
        JSON.stringify(listing, null, 2) + "\n",
      );
      await mkdir(join(folder, "screenshots", locale), { recursive: true });
      for (const screen of ["accounts", "data", "settings"])
        await cp(
          `${output}/${locale}/${screen}-1280x800.png`,
          join(folder, "screenshots", locale, `${screen}.png`),
        );
    }
    await writeFile(
      join(folder, "README.md"),
      `# ${target === "firefox" ? "Firefox AMO" : "Microsoft Edge Add-ons"}\n\nVersion: ${version}\n\nUpload extension.zip only as the extension package.${target === "firefox" ? " Upload source.zip separately for source review." : ""}\n\nSee [submission checklist](../docs/store/${target}.md), [reviewer notes](../docs/store/reviewer-notes.md), [privacy](../PRIVACY.md) and [permission explanations](../docs/store/permissions.md).\n\nListings: listing.en.json and listing.zh-CN.json. Contact: support@macseek.cc.\n\nScreenshots were captured from the actual extension in headless Edge with synthetic accounts.${target === "firefox" ? " Firefox runtime verification and any necessary recapture remain required." : ""}\n\nStatus: preparation only; not submitted. Resolve the checklist's data-consent, privacy/security and publication items before submission.\n`,
    );
    await writeFile(
      join(folder, "submission.json"),
      JSON.stringify(
        {
          version,
          target,
          extensionId:
            targetManifest.browser_specific_settings?.gecko.id ?? null,
          package: "extension.zip",
          source: target === "firefox" ? "source.zip" : null,
          manifestLocales: await readdir(`dist/${target}/_locales`),
          preparedListingLocales: ["en", "zh-CN"],
          screenshotBrowser: "Edge",
          submitted: false,
          readyToSubmit: false,
          outstanding:
            target === "firefox"
              ? [
                  "Firefox data transmission consent implementation",
                  "Firefox runtime verification",
                  "Published policy/support URLs",
                  "Publisher account verification",
                ]
              : [
                  "Policy/security review of local plaintext secrets",
                  "Published policy/support URLs",
                  "Publisher account verification",
                  "Listing fields for all enabled locales",
                  "Edge browser-restart smoke verification",
                ],
        },
        null,
        2,
      ) + "\n",
    );
    const checksums = [];
    for (const relative of (
      await readdir(folder, { recursive: true })
    ).sort()) {
      if (!/\.(zip|png|json|md)$/.test(relative)) continue;
      const hash = createHash("sha256")
        .update(await readFile(join(folder, relative)))
        .digest("hex");
      checksums.push(`${hash}  ${relative}`);
    }
    await writeFile(join(folder, "SHA256SUMS"), checksums.join("\n") + "\n");
  }
  await writeFile(
    join(output, "material-version.json"),
    JSON.stringify(
      {
        version,
        browser: "Headless Chromium-compatible browser (Edge by default)",
        syntheticAccountsOnly: true,
        locales: ["en", "zh-CN"],
        screenshots: { width: 1280, height: 800 },
        operaReference: { width: 612, height: 408 },
      },
      null,
      2,
    ) + "\n",
  );
  const downloads = join(homedir(), "Downloads/dist/store");
  await rm(downloads, { recursive: true, force: true });
  await cp(output, downloads, { recursive: true });
  console.log(
    `Store materials ${version}: ${resolve(output)} and ${downloads}`,
  );
} finally {
  for (const client of clients) client.socket.close();
  child.kill("SIGTERM");
  await exited;
  await rm(profile, { recursive: true, force: true });
}
