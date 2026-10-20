// Runs `next dev` and `tauri dev` together for desktop development.
// The Tauri shell reads HELIOS_DEV_URL and just points its window there.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEV_URL = process.env.HELIOS_DEV_URL || "http://localhost:3000";
const APP_VERSION = JSON.parse(
  readFileSync(join(ROOT, "src-tauri", "tauri.conf.json"), "utf8"),
).version;

const children = [];
// Both children are Node scripts started with this same Node and no shell: a
// shell (needed on Windows only for .cmd shims) would split paths that contain
// spaces, e.g. C:\Users\Jane Doe\HeliosGen.
function launch(name, script, args, extraEnv = {}) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  child.on("exit", (code) => {
    console.log(`[desktop:dev] ${name} exited (${code})`);
    shutdown();
  });
  children.push(child);
}

function shutdown() {
  for (const c of children) {
    if (!c.killed) c.kill("SIGTERM");
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

launch("next", join(ROOT, "node_modules", "next", "dist", "bin", "next"), ["dev"], {
  NEXT_PUBLIC_APP_VERSION: APP_VERSION,
  NODE_OPTIONS: "--disable-warning=ExperimentalWarning", // node:sqlite
});

launch("tauri", join(ROOT, "node_modules", "@tauri-apps", "cli", "tauri.js"), ["dev"], {
  HELIOS_DEV_URL: DEV_URL,
});
