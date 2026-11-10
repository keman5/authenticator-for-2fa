import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import sharp from "sharp";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
let notices = await readFile("LICENSE", "utf8");
for (const [name, file, from] of [
  ["qrcode", "license"],
  ["react", "LICENSE"],
  ["react-dom", "LICENSE"],
  ["lucide-react", "LICENSE"],
  ["tldts", "LICENSE"],
  ["zxing-wasm", "LICENSE"],
  ["daisyui", "LICENSE"],
  ["tailwindcss", "LICENSE"],
  ["dijkstrajs", "LICENSE.md", "qrcode"],
]) {
  const resolver = from
    ? createRequire(require.resolve(from + "/package.json"))
    : require;
  let root = dirname(resolver.resolve(name));
  while (true) {
    try {
      if (
        JSON.parse(await readFile(join(root, "package.json"), "utf8")).name ===
        name
      )
        break;
    } catch {}
    if (dirname(root) === root)
      throw new Error("Missing package license: " + name);
    root = dirname(root);
  }
  notices +=
    "\n\n--- " + name + " ---\n" + (await readFile(join(root, file), "utf8"));
}
notices +=
  "\n\nZXing-C++ and ZXingWasm.cpp: Apache-2.0\n" +
  (await readFile("docs/licenses/Apache-2.0.txt", "utf8")) +
  "\n\nzint:\n" +
  (await readFile("docs/licenses/zint.txt", "utf8"));
const { version: packageVersion, extensionVersion } = JSON.parse(
  await readFile("package.json", "utf8"),
);
const version = extensionVersion ?? packageVersion;
// The SVG uses the icon24 reference's 3px ring at 24px (6 / 48 viewBox units).
const icon = await readFile("assets/brand/icons/authenticator-2fa-icon.svg");
for (const size of [16, 32, 48, 128])
  await sharp(icon)
    .resize(size, size)
    .png()
    .toFile(`assets/extension/icons/icon${size}.png`);
const locales = {
  en: [
    "One-time codes, optional screen lock and encrypted portable backups.",
    "Open with screen lock",
  ],
  ko: ["일회용 코드, 선택적 화면 잠금 및 암호화된 백업.", "화면 잠금으로 열기"],
  zh_TW: ["動態驗證碼、可選介面鎖與加密備份。", "透過介面鎖開啟"],
  zh_CN: ["动态验证码、可选界面锁与加密备份。", "通过界面锁打开"],
  de: [
    "Einmalcodes, optionale Bildschirmsperre und verschlüsselte Backups.",
    "Mit Sperre öffnen",
  ],
  fr: [
    "Codes uniques, verrouillage facultatif et sauvegardes chiffrées.",
    "Ouvrir avec verrouillage",
  ],
  es: [
    "Códigos de un solo uso, bloqueo opcional y copias cifradas.",
    "Abrir con bloqueo",
  ],
  pt_BR: [
    "Códigos temporários, bloqueio opcional e backups criptografados.",
    "Abrir com bloqueio",
  ],
  ja: [
    "ワンタイムコード、任意の画面ロック、暗号化バックアップ。",
    "画面ロックで開く",
  ],
  ru: [
    "Одноразовые коды, блокировка экрана и зашифрованные копии.",
    "Открыть с блокировкой",
  ],
  tr: [
    "Tek kullanımlık kodlar, isteğe bağlı ekran kilidi ve şifreli yedekler.",
    "Kilitle aç",
  ],
  ar: ["رموز مؤقتة وقفل شاشة اختياري ونسخ احتياطية مشفرة.", "فتح مع القفل"],
  hi: [
    "एक बार के कोड, वैकल्पिक स्क्रीन लॉक और एन्क्रिप्टेड बैकअप।",
    "लॉक के साथ खोलें",
  ],
  bn: [
    "একবারের কোড, ঐচ্ছিক স্ক্রিন লক ও এনক্রিপ্ট করা ব্যাকআপ।",
    "লক দিয়ে খুলুন",
  ],
};
for (const [locale, [description, normal]] of Object.entries(locales)) {
  const path = `assets/extension/_locales/${locale}`;
  await mkdir(path, { recursive: true });
  const inherited = JSON.parse(
    await readFile(`${path}/messages.json`, "utf8").catch(() => "{}"),
  );
  delete inherited.direct;
  const messages = {
    name: "Authenticator - 2FA",
    shortName: "2FA Codes",
    description,
    title: "Authenticator - 2FA",
    normal,
  };
  await writeFile(
    `${path}/messages.json`,
    JSON.stringify(
      {
        ...inherited,
        ...Object.fromEntries(
          Object.entries(messages).map(([key, message]) => [key, { message }]),
        ),
      },
      null,
      2,
    ),
  );
}
for (const target of ["chrome", "edge", "firefox", "safari"]) {
  const path = `dist/${target}`;
  await rm(path, { recursive: true, force: true });
  await cp("dist/web", path, { recursive: true });
  await cp("assets/extension", path, { recursive: true });
  await writeFile(`${path}/LICENSE.txt`, notices);
  for (const document of ["PRIVACY.md", "PRIVACY.zh-CN.md", "SUPPORT.md"])
    await cp(document, `${path}/${document}`);
  const manifest = {
    manifest_version: 3,
    name: "__MSG_name__",
    short_name: "__MSG_shortName__",
    description: "__MSG_description__",
    version,
    default_locale: "en",
    homepage_url: "https://github.com/keman5/authenticator-for-2fa",
    icons: Object.fromEntries(
      [16, 32, 48, 128].map((n) => [n, `icons/icon${n}.png`]),
    ),
    action: {
      default_popup: "index.html",
      default_title: "__MSG_title__",
      default_icon: { 16: "icons/icon16.png", 32: "icons/icon32.png" },
    },
    permissions: ["storage", "activeTab", "scripting", "nativeMessaging"],
    optional_host_permissions: ["http://*/*", "https://*/*"],
    commands: {
      _execute_action: {
        suggested_key: { default: "Ctrl+Shift+2", mac: "Command+Shift+2" },
        description: "__MSG_normal__",
      },
    },
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; connect-src 'self' data: https://www.google.com",
    },
  };
  if (target === "firefox") {
    manifest.background = { scripts: ["assets/worker.js"], type: "module" };
    manifest.browser_specific_settings = {
      gecko: {
        id: "authenticator-for-2fa@macseek.cc",
        strict_min_version: "140.0",
        data_collection_permissions: { required: ["none"] },
      },
      gecko_android: { strict_min_version: "142.0" },
    };
  } else if (target === "safari") {
    manifest.background = { page: "background.html" };
    await writeFile(
      `${path}/background.html`,
      '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="assets/worker.js"></script></head><body></body></html>',
    );
  } else
    manifest.background = {
      service_worker: "assets/worker.js",
      type: "module",
    };
  await writeFile(
    `${path}/manifest.json`,
    JSON.stringify(manifest, null, 2) + "\n",
  );
}
console.log("Built Chrome, Edge, Firefox and Safari extension resources.");
