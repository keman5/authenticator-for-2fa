import assert from "node:assert/strict";
import { readFile, readdir, access } from "node:fs/promises";
const read = async (path) => JSON.parse(await readFile(path, "utf8"));
for (const target of ["chrome", "edge", "firefox", "safari"]) {
  const root = `dist/${target}`;
  const manifest = await read(`${root}/manifest.json`);
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(Object.keys(manifest.commands), ["_execute_action"]);
  assert.equal(manifest.default_locale, "en");
  assert.equal(
    manifest.homepage_url,
    "https://github.com/keman5/authenticator-for-2fa",
  );
  assert.deepEqual(manifest.permissions, [
    "storage",
    "activeTab",
    "scripting",
    "nativeMessaging",
  ]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(
    manifest.content_security_policy.extension_pages,
    "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; connect-src 'self' data: https://www.google.com",
  );
  for (const locale of await readdir(`${root}/_locales`)) {
    const values = await read(`${root}/_locales/${locale}/messages.json`);
    assert.equal(values.name.message, "Authenticator - 2FA");
    assert.ok(values.shortName.message.length <= 12);
    for (const field of [
      manifest.name,
      manifest.short_name,
      manifest.description,
      manifest.action.default_title,
      ...Object.values(manifest.commands).map((command) => command.description),
    ])
      assert.ok(
        values[field.slice(6, -2)]?.message,
        `${target}/${locale}: ${field}`,
      );
  }
  const worker =
    manifest.background.service_worker ??
    manifest.background.scripts?.[0] ??
    manifest.background.page;
  await access(`${root}/${worker}`);
  await access(`${root}/assets/injected.js`);
  await access(`${root}/LICENSE.txt`);
  assert.doesNotMatch(
    await readFile(`${root}/assets/injected.js`, "utf8"),
    /^\s*(import |export )/m,
  );
  const html = await readFile(`${root}/index.html`, "utf8");
  for (const [, file] of html.matchAll(/(?:src|href)="([^"]+)"/g))
    await access(`${root}/${file.replace(/^\//, "")}`);
  assert.ok(
    (await readdir(`${root}/assets`)).some((file) => file.endsWith(".wasm")),
  );
  if (target === "firefox")
    assert.equal(
      manifest.browser_specific_settings.gecko.id,
      "authenticator-for-2fa@macseek.cc",
    );
}
console.log(
  "PASS manifests, localization, packaged scripts/WASM/licenses and isolated injection.",
);
