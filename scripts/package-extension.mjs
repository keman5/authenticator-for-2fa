import {
  readdir,
  readFile,
  writeFile,
  mkdir,
  access,
  stat,
} from "node:fs/promises";
import { zipSync } from "fflate";
import { join } from "node:path";
import { homedir } from "node:os";
import { cp } from "node:fs/promises";
const { version: packageVersion, extensionVersion } = JSON.parse(
  await readFile("package.json", "utf8"),
);
const version = extensionVersion ?? packageVersion;
await mkdir("artifacts", { recursive: true });
async function tree(root, relative = "", skip = new Set()) {
  const result = {};
  for (const item of await readdir(join(root, relative), {
    withFileTypes: true,
  })) {
    if (skip.has(item.name) || item.isSymbolicLink()) continue;
    const path = join(relative, item.name);
    if (item.isDirectory()) Object.assign(result, await tree(root, path, skip));
    else {
      const file = join(root, path);
      result[path] = [
        new Uint8Array(await readFile(file)),
        { os: 3, attrs: (await stat(file)).mode << 16 },
      ];
    }
  }
  return result;
}
for (const target of ["chrome", "edge", "firefox", "safari"])
  await writeFile(
    `artifacts/authenticator-for-2fa-${version}-${target}.zip`,
    zipSync(await tree(`dist/${target}`), { level: 9 }),
  );
const sources = {};
for (const directory of [
  "src",
  "test",
  "scripts",
  "assets",
  "docs",
  "native",
]) {
  Object.assign(sources, await tree(".", directory));
}
for (const name of [
  "package.json",
  "pnpm-lock.yaml",
  "build.sh",
  "index.html",
  "vite.config.ts",
  "AGENTS.md",
  "tsconfig.json",
  "tsconfig.test.json",
  "README.md",
  "LICENSE",
  "PRIVACY.md",
  "PRIVACY.zh-CN.md",
  "SUPPORT.md",
]) {
  sources[name] = new Uint8Array(await readFile(name));
}
await writeFile(
  `artifacts/authenticator-for-2fa-${version}-source.zip`,
  zipSync(sources, { level: 9 }),
);
console.log("Extension and review-source archives written to artifacts/.");

try {
  await access("dist/touch-id/Authenticator Touch ID.app");
  await writeFile(
    `artifacts/authenticator-for-2fa-${version}-touch-id-macos.zip`,
    zipSync(await tree("dist/touch-id"), { level: 9 }),
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const downloads = join(homedir(), "Downloads", "dist");
await mkdir(downloads, { recursive: true });
for (const name of await readdir("artifacts"))
  if (
    name.startsWith(`authenticator-for-2fa-${version}-`) &&
    name.endsWith(".zip")
  )
    await cp(join("artifacts", name), join(downloads, name));
console.log("Current release packages copied to " + downloads);
