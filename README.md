<p align="center">
  <img
    src="src-tauri/icons/128x128.png"
    alt="CactusGen"
    width="64"
  />
</p>

<p align="center">
  <strong>Build AI image & video pipelines visually.</strong><br/>
  Chain prompts, models, reference images, and automations on an infinite canvas.
</p>

CactusGen is based on [HeliosGen](https://github.com/SegFault42/HeliosGen) by SegFault42 (MIT).

---

# ⬇️ Download

**CactusGen is a desktop app.** Grab the latest build for your OS from the
releases page — no account, no server, no cloud setup:

### 👉 **[Download from the Releases page](../../releases/latest)**

| OS | File |
| --- | --- |
| **macOS** (Apple Silicon) | `CactusGen_<version>_aarch64.dmg` |
| **Windows** (64-bit) | `CactusGen_<version>_x64-setup.exe` |
| **Linux** | 🙋 **looking for a contributor to build & submit** — see below |

> Only the builds actually attached to the latest release are available. The
> Windows installer and the Apple Silicon .dmg are built automatically by
> GitHub Actions (see **Releasing** below). **Tauri can't cross-compile, so a Linux build needs someone on
> Linux** — if you can run `npm run desktop:build` there (see the **Build from
> source** section below), please open a PR or attach the artifacts to an issue
> and we'll add them to the release.

The app is **not code-signed** yet:

- **macOS** — after dragging the app into Applications, open **Terminal** once
  and run `xattr -cr /Applications/CactusGen.app` (recent macOS versions no
  longer offer right-click → Open for unsigned apps).
- **Windows** — SmartScreen: **More info → Run anyway**.

## Windows

1. Open the **[latest release](../../releases/latest)** and download
   `CactusGen_<version>_x64-setup.exe`.
2. Run it. The installer isn't code-signed, so Windows SmartScreen may show
   "Windows protected your PC" — click **More info → Run anyway**. It installs
   for your user only; no admin rights needed.
3. On first launch, open **Settings → API Keys** and paste either a
   [kie.ai](https://kie.ai?ref=25abb3f2236cbff9780ab9c2f84479ec) API key or a
   [Revana](https://revana.si) API key.

---

## 🚀 First run

1. Launch CactusGen.
2. Open **Settings → API Keys** and paste your **[kie.ai](https://kie.ai?ref=25abb3f2236cbff9780ab9c2f84479ec) API key**.
3. Start generating.

Everything stays on your machine. Generations, uploads, folders, workflows and
settings live in a local database; media is saved to a local folder:

| OS | Data location |
| --- | --- |
| macOS | `~/Library/Application Support/com.cactusmedia.cactusgen/` |
| Windows | `%APPDATA%\com.cactusmedia.cactusgen\` |
| Linux | `~/.local/share/com.cactusmedia.cactusgen/` |

Delete that folder to reset the app.

---

# 📸 Screenshots
## ✨ Simple Image & Video Generation

<p align="center">
  <img width="2912" height="2292" alt="Image generation example" src="https://github.com/user-attachments/assets/8263b83d-addb-4af8-99d1-d8406c52be2c" />
</p>

---

## 🔄 Workflow Generation

<p align="center">
  <img width="1459" height="1146" alt="Workflow generation example" src="https://github.com/user-attachments/assets/fc7f1109-76d1-4af0-b91d-0e915bcf5461" />
</p>

---

## 🧠 Native JSON Prompt Preview

<p align="center">
  <img width="886" alt="JSON prompt preview" src="https://github.com/user-attachments/assets/dedbdf4f-9d52-4e29-ad6e-a2e67e341a73" />
</p>

---

## 💬 AI Prompt Improvement Assistant

<p align="center">
  <img width="872" height="502" alt="Prompt assistant interface" src="https://github.com/user-attachments/assets/17ba972c-bd8a-49a7-b367-4ef906fe3e17" />
</p>

# ✨ CactusGen

CactusGen is a free & open source visual AI workflow builder for image and video generation.

Build reusable AI pipelines with:
- infinite node-based workflows,
- multi-model generation,
- reference images,
- automation chains,
- all running 100% locally on your machine.

No subscriptions.  
No disappearing credits.  
No vendor lock-in.  
No cloud, no accounts — just a local app and your own kie.ai key.

---

# 💳 Credits

CactusGen now works with <a href="https://kie.ai?ref=25abb3f2236cbff9780ab9c2f84479ec" target="_blank">kie.ai</a>.

All credits are purchased directly on your own account and never expire.

That means:
- no monthly reset,
- no lost credits,
- no subscription lock-in,
- and full ownership of your usage.

You only pay for what you generate.

---

# 🚀 Features

- Infinite node-based canvas
- AI image & video generation
- Drag-and-connect workflow system
- Multi-model pipelines
- Reference image support
- Parallel & sequential pipeline execution
- Real-time generation history
- 100% local — your data never leaves your machine
- Bring your own kie.ai or Revana key
- `@image1` / `@video1` / `@audio1` mentions of attached references in the Create prompt (Seedance-style)
- **Improve prompt** — Claude turns a rough idea into a shot-by-shot prompt that uses your `@image` tags
- Chat and the canvas assistant on Claude (your own Anthropic key, or through kie.ai)
- **Connect Claude (MCP)** — let Claude Code / Claude Desktop list models, check prices and generate for you
- Modern responsive UI

---

# ⚡ Supported Models

## Images
- GPT Image 2 (OpenAI)
- Nano Banana / Nano Banana 2 / Nano Banana 2 Lite / Nano Banana Pro (Google)
- Seedream 5.0 Lite / Pro (Seedream)
- Z-Image (Z-AI)
- Grok Imagine (X)

## Videos
- Veo 3.1 Lite / Fast / Quality, Gemini Omni Video (Google)
- Kling 3.0, Kling 3.0 Turbo, Motion Control 2.6 / 3.0 (Kling)
- Seedance 2.0 / Fast / Mini (Bytedance)
- Grok Imagine, Grok Imagine 1.5 preview (X)
- HappyHorse (Alibaba)

More models are coming.

---

# 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2 (Rust) |
| App | Next.js + React + TypeScript (bundled Node sidecar) |
| Database | SQLite (local) |
| Storage | Local disk |
| AI Backend | kie.ai, Revana, Claude (Anthropic) |

---

# 🧠 Claude in CactusGen

- **Settings → API Keys → Claude (Anthropic) API key** (optional): Chat, the canvas assistant and the
  Create page's **Improve prompt** button (sparkle icon) call Claude directly with it. Without it they go
  through kie.ai's Claude proxy with your Kie.ai key. Models: Claude Opus 5.5, Sonnet 5.5 (default),
  Haiku 5.5, Fable 5.1. `ANTHROPIC_API_KEY` works as a fallback.
- **Improve prompt** sends your idea, the model's settings and small copies of the attached references
  (as `@image1` …) to Claude Sonnet 5.5 and replaces the prompt with a full shot-by-shot version —
  **Undo improve** brings yours back.

## Connect Claude Code / Claude Desktop (MCP)

CactusGen runs an MCP server at `http://127.0.0.1:<port>/api/mcp` (Streamable HTTP, loopback only,
bearer token). **Settings → Connect Claude (MCP)** shows the exact URL, the token and copy-ready snippets:

```bash
claude mcp add --transport http cactusgen http://127.0.0.1:41730/api/mcp --header "Authorization: Bearer <TOKEN>"
```

Claude Desktop (`claude_desktop_config.json`, needs Node.js):

```json
{
  "mcpServers": {
    "cactusgen": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:41730/api/mcp", "--header", "Authorization:${AUTH_HEADER}"],
      "env": { "AUTH_HEADER": "Bearer <TOKEN>" }
    }
  }
}
```

Tools: `list_models`, `estimate_cost`, `generate_video` (Seedance 2.5 by default), `generate_image`
(GPT Image 2.5 Flare by default), `get_job` (waits up to 50 s, returns the local file paths) and
`list_history`. Images can be absolute local paths, https URLs or data: URLs; prompts mention them as
`@image1` …. Generations started this way show up on the Create page like any other. They spend your
credit — keep the token private (**Regenerate token** revokes it). The desktop app prefers port 41730;
if that's taken it uses the next free one, and Settings shows the real URL.

---

# 🤖 Codex CLI (optional — alternate GPT Image 2 backend)

Instead of routing GPT Image 2 through kie.ai credits, CactusGen can generate through your own ChatGPT Codex subscription via [`codex-imagegen-cli`](https://github.com/jdmnk/codex-imagegen-cli). The desktop app picks up `codex` from your `PATH` automatically; if it's missing, the feature just shows **NOT CONFIGURED** and everything else keeps working.

Requirements:
- A ChatGPT Plus/Pro/Team/Enterprise account with Codex access
- [`codex`](https://github.com/openai/codex) CLI installed on your machine
- [`uv`](https://docs.astral.sh/uv/) (Python package manager)

### 1. Install the Codex CLI

```bash
# macOS
brew install codex

# or, cross-platform
npm install -g @openai/codex
```

### 2. Install codex-imagegen-cli

```bash
git clone https://github.com/jdmnk/codex-imagegen-cli.git
cd codex-imagegen-cli
uv sync --dev
uv tool install -e .
```

This installs the `codex-imagegen` binary — make sure it's on your `PATH`.

### 3. Log in

Either:
- run `codex login` in a terminal (opens a browser to sign in), **or**
- open the app → **Settings → API Keys → Codex CLI → Connect Codex**, which walks you through a device-code login — visit the printed URL and enter the code, no terminal needed.

> ⚠️ Starting a new login (either way) immediately invalidates any existing session on that machine — the CLI clears old credentials the moment a login attempt begins, whether or not it's ever completed. Only start one when the status badge below shows **NOT CONFIGURED**.

### 4. Enable it for GPT Image 2

In **Settings → Image Models**, set GPT Image 2's provider toggle to **Codex CLI**. The status badge in **Settings → API Keys** shows **READY** once both the CLI and login are in place.

---

# 🛠️ Build from source

Prefer to build it yourself, or need a platform that isn't on the releases page
yet? The whole app builds from this repo.

Tauri does **not** cross-compile — build on the OS you want to target. Run
`npm run desktop:build` on a Mac for the macOS build, on Windows for Windows,
on Linux for Linux.

> **Want to help ship Linux builds?** Build on Linux and send the artifacts (PR
> or issue attachment) — they'll be added to the next release, with credit.
> Windows builds are made by GitHub Actions (see **Releasing** below).

## Prerequisites (one-time, all platforms)

| Tool | Notes |
| --- | --- |
| **Node 22+** | The bundled server uses `node:sqlite`. `nvm use 22`. |
| **Rust** | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| **Tauri system deps** | See <https://v2.tauri.app/start/prerequisites/> |

Platform-specific system deps:

- **macOS** — Xcode Command Line Tools: `xcode-select --install`
- **Windows** — [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
  (Desktop development with C++) and [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)
  (preinstalled on Windows 11)
- **Linux** — `webkit2gtk-4.1`, `librsvg2`, `build-essential`, `curl`, `wget`,
  `file`, `libssl-dev`, `libayatana-appindicator3-dev` (Debian/Ubuntu package
  names; see the Tauri prerequisites page for other distros)

## Build

```bash
git clone <this repository's URL> CactusGen
cd CactusGen
npm install
npm run desktop:build
```

Artifacts land in `src-tauri/target/release/bundle/`:

| OS | Output |
| --- | --- |
| macOS | `macos/CactusGen.app`, `dmg/CactusGen_<ver>_<arch>.dmg` |
| Windows | `msi/CactusGen_<ver>_x64_en-US.msi`, `nsis/CactusGen_<ver>_x64-setup.exe` |
| Linux | `deb/`, `rpm/`, `appimage/CactusGen_<ver>_amd64.AppImage` |

The macOS build is **unsigned** — on first launch Gatekeeper blocks it.
Right-click → Open, or `xattr -cr "src-tauri/target/release/bundle/macos/CactusGen.app"`.

## Develop (hot reload)

```bash
npm run desktop:dev
```

Runs `next dev` and `tauri dev` together. The first run compiles the Rust shell
(~1–2 min).

See [`DESKTOP.md`](DESKTOP.md) for architecture, data locations, and signing &
notarization.

## Releasing (maintainers)

The Windows installer is built by GitHub Actions
([`.github/workflows/release.yml`](.github/workflows/release.yml)) — no
Windows PC or signing certificate needed.

1. Bump the version to the same `X.Y.Z` in all of these:
   - `package.json` → `"version"`
   - `src-tauri/tauri.conf.json` → `"version"`
   - `src-tauri/Cargo.toml` → `version` under `[package]`
   - `src-tauri/Cargo.lock` → the `version` line right under
     `name = "heliosgen-desktop"`
2. Check they agree: `node scripts/desktop/check-version.mjs X.Y.Z`
3. Commit, then tag and push:
   ```bash
   git tag vX.Y.Z
   git push && git push --tags
   ```
4. The **release** workflow builds the installer (about 15–20 minutes) and
   publishes the release `vX.Y.Z` with `CactusGen_X.Y.Z_x64-setup.exe` (plus an
   `.msi` when that builds) attached. You can also start it by hand from the
   **Actions** tab (**release → Run workflow**); it then releases whatever
   version is in `tauri.conf.json`.

The workflow fails early if the tag doesn't match the version files. The app's
update check looks at the releases of the repository it was built from —
`lib/appInfo.ts` (`GITHUB_REPO`). The workflow sets that to its own repository
automatically; if you build releases another way from a fork, change the
default there.

---

# 🤝 Contributions

Contributions are welcome.

If you find a bug, have an idea, or want to improve CactusGen:
- Open an issue
- Submit a pull request
- Share feedback or feature requests

All contributions are appreciated.

---

# 📄 License

MIT License. CactusGen is based on [HeliosGen](https://github.com/SegFault42/HeliosGen) by SegFault42,
also MIT-licensed; the original copyright stays with its authors, CactusGen changes are by the CactusGen
contributors.

---

<p align="center">
  Built for creators building the future of AI workflows.
</p>

