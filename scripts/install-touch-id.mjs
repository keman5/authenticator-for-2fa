import { cp, mkdir, writeFile, rm, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

// Chromium unpacked IDs are derived from the absolute extension directory.
export function unpackedID(path) {
  return [
    ...createHash("sha256").update(resolve(path)).digest().subarray(0, 16),
  ]
    .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
    .join("");
}
export async function install({ root = homedir(), ids = [], app } = {}) {
  if (process.platform !== "darwin")
    throw new Error("Touch ID requires macOS.");
  if (ids.some((id) => !/^[a-p]{32}$/.test(id)))
    throw new Error(
      "Expected a 32-character Chromium extension ID from Settings.",
    );
  const base = join(root, "Library/Application Support");
  const host = "local.authenticator_workspace.touchid";
  const destination = join(
    base,
    "Authenticator Workspace",
    "Authenticator Touch ID.app",
  );
  await access(join(app, "Contents/MacOS/AuthenticatorTouchID"));
  await mkdir(dirname(destination), { recursive: true });
  await rm(destination, { recursive: true, force: true });
  await cp(app, destination, { recursive: true });
  const origins = [
    ...new Set([...ids, unpackedID("dist/chrome"), unpackedID("dist/edge")]),
  ].map((id) => `chrome-extension://${id}/`);
  const manifest = {
    name: host,
    description: "Authenticator Touch ID",
    path: join(destination, "Contents/MacOS/AuthenticatorTouchID"),
    type: "stdio",
  };
  for (const [directory, allowed] of [
    ["Google/Chrome/NativeMessagingHosts", { allowed_origins: origins }],
    ["Microsoft Edge/NativeMessagingHosts", { allowed_origins: origins }],
    [
      "Mozilla/NativeMessagingHosts",
      { allowed_extensions: ["authenticator-2fa@macseek.cc"] },
    ],
  ]) {
    const folder = join(base, directory);
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, host + ".json"),
      JSON.stringify({ ...manifest, ...allowed }, null, 2) + "\n",
      { mode: 0o600 },
    );
  }
  return destination;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const folder = dirname(fileURLToPath(import.meta.url));
  const app = folder.endsWith("/scripts")
    ? resolve(folder, "../dist/touch-id/Authenticator Touch ID.app")
    : join(folder, "Authenticator Touch ID.app");
  const destination = await install({ app, ids: process.argv.slice(2) });
  console.log(`Touch ID companion registered: ${destination}`);
}
