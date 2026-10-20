// Preloaded before the Next.js server (node -r) in the packaged desktop app.
//
// If the Tauri shell that spawned us dies without killing us (a crash, a
// force-quit, SIGKILL), we must exit too, so we don't leave an orphaned server
// holding the port.
//
// - macOS / Linux reparent an orphan to launchd / init (pid 1), so a changed
//   `process.ppid` gives it away.
// - Windows never reparents: `process.ppid` keeps reporting the dead parent's
//   PID. So also probe whether that PID is still alive — signal 0 only checks
//   for existence and never actually signals the process.
const parentAtStart = process.ppid;

function parentAlive() {
  try {
    process.kill(parentAtStart, 0);
    return true;
  } catch (err) {
    // EPERM = it exists but belongs to someone else; anything else (ESRCH) = gone.
    return err && err.code === "EPERM";
  }
}

setInterval(() => {
  if (process.ppid !== parentAtStart || process.ppid === 1 || !parentAlive()) {
    console.error("[sidecar-guard] parent process gone — shutting down");
    process.exit(0);
  }
}, 2000).unref();
