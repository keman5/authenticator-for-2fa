import { spawn } from "node:child_process";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { install } from "./install-touch-id.mjs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const binary = resolve(
  "dist/touch-id/Authenticator Touch ID.app/Contents/MacOS/AuthenticatorTouchID",
);
async function call(payload, length) {
  const data = Buffer.from(JSON.stringify(payload));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(length ?? data.length);
  return new Promise((resolve, reject) => {
    const process = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const output = [];
    const errors = [];
    const timer = setTimeout(() => {
      process.kill();
      reject(Error("Native host timeout"));
    }, 8000);
    process.stdout.on("data", (data) => output.push(data));
    process.stderr.on("data", (data) => errors.push(data));
    process.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    process.on("close", (code) => {
      clearTimeout(timer);
      try {
        assert.equal(code, 0, Buffer.concat(errors).toString());
        const result = Buffer.concat(output);
        assert.ok(result.length >= 4);
        assert.equal(result.readUInt32LE(0), result.length - 4);
        resolve(JSON.parse(result.subarray(4).toString()));
      } catch (error) {
        reject(error);
      }
    });
    process.stdin.end(Buffer.concat([header, data]));
  });
}
const nonce = "a".repeat(64);
for (const payload of [
  { version: 2, action: "authenticate", nonce, reason: "Unlock" },
  { version: 1, action: "authenticate", nonce, reason: "" },
  { version: 1, action: "unknown", nonce },
]) {
  const reply = await call(payload);
  assert.equal(reply.verified, false);
  assert.equal(reply.error, "invalid");
}
assert.equal((await call({}, 8192)).error, "invalid");
const availability = await call({ version: 1, action: "status", nonce });
assert.equal(availability.version, 1);
assert.equal(availability.nonce, nonce);
assert.equal(availability.verified, false);
assert.equal(typeof availability.supported, "boolean");
console.log(
  "PASS native framing, bounded input, invalid requests and noninteractive Touch ID probe:",
  availability,
);

const root = await mkdtemp(join(tmpdir(), "auth-native-install-"));
try {
  const app = resolve("dist/touch-id/Authenticator Touch ID.app");
  const id = "a".repeat(32);
  await install({ root, ids: [id], app });
  const base = join(root, "Library/Application Support");
  const chromium = JSON.parse(
    await readFile(
      join(
        base,
        "Microsoft Edge/NativeMessagingHosts/local.authenticator_workspace.touchid.json",
      ),
      "utf8",
    ),
  );
  assert.ok(chromium.allowed_origins.includes(`chrome-extension://${id}/`));
  assert.ok(chromium.path.startsWith(root));
  const firefox = JSON.parse(
    await readFile(
      join(
        base,
        "Mozilla/NativeMessagingHosts/local.authenticator_workspace.touchid.json",
      ),
      "utf8",
    ),
  );
  assert.deepEqual(firefox.allowed_extensions, [
    "authenticator-for-2fa@macseek.cc",
  ]);
  await assert.rejects(install({ root, ids: ["*"], app }));
  console.log(
    "PASS native-host installer in a disposable directory, exact extension allowlists.",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
