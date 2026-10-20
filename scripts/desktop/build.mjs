// `pnpm desktop:build` / `npm run desktop:build` — works the same on macOS,
// Linux and Windows:
//
//   1. scripts/desktop/check-version.mjs — the version files must agree
//   2. `tauri build` with CI=true
//
// This replaces `node check-version.mjs && CI=true tauri build`: the `CI=true cmd`
// prefix is POSIX shell syntax that cmd.exe and PowerShell reject. CI=true makes
// Tauri skip interactive prompts, and on macOS lets the .dmg step skip its
// Finder/AppleScript window styling.
//
// Extra arguments go straight to `tauri build`, e.g.
//   pnpm desktop:build --bundles nsis
//   npm run desktop:build -- --bundles nsis

import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

// Run Node scripts with this same Node, without a shell, so paths with spaces
// work and no .cmd shim is involved on Windows.
function node(args, env = process.env) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit", env });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

const checked = node([join(HERE, "check-version.mjs")]);
if (checked !== 0) process.exit(checked);

const tauriCli = join(ROOT, "node_modules", "@tauri-apps", "cli", "tauri.js");
process.exit(node([tauriCli, "build", ...process.argv.slice(2)], { ...process.env, CI: "true" }));
