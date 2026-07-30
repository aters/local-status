import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareBrandedElectron } from "./electron-runtime.mjs";

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vite = join(appDirectory, "node_modules", "vite", "bin", "vite.js");

const renderer = spawn(process.execPath, [vite], {
  cwd: appDirectory,
  stdio: "inherit",
});

let desktop;
let stopping = false;
let restarting = false;
let restartTimer = null;
const mainProcessWatchers = [];

async function waitForRenderer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:5173");
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("The renderer did not become ready.");
}

function stop() {
  if (stopping) return;
  stopping = true;
  if (restartTimer) clearTimeout(restartTimer);
  for (const watcher of mainProcessWatchers) watcher.close();
  renderer.kill("SIGTERM");
  desktop?.kill("SIGTERM");
}

function launchDesktop() {
  desktop = spawn(prepareBrandedElectron(), [appDirectory], {
    cwd: appDirectory,
    env: {
      ...process.env,
      LOCAL_STATUS_DEV_URL: "http://127.0.0.1:5173",
    },
    stdio: "inherit",
  });
  desktop.once("exit", () => {
    desktop = undefined;
    if (stopping) return;
    if (restarting) {
      restarting = false;
      launchDesktop();
      return;
    }
    stop();
  });
}

function scheduleDesktopRestart() {
  if (stopping) return;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (!desktop) {
      launchDesktop();
      return;
    }
    restarting = true;
    desktop.kill("SIGTERM");
  }, 180);
}

try {
  await waitForRenderer();
  launchDesktop();
  for (const directory of ["electron", "server"]) {
    mainProcessWatchers.push(
      watch(
        join(appDirectory, directory),
        { recursive: true },
        scheduleDesktopRestart,
      ),
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stop();
  process.exitCode = 1;
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
