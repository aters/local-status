import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vite = join(appDirectory, "node_modules", "vite", "bin", "vite.js");
const electron = join(appDirectory, "node_modules", "electron", "cli.js");

const renderer = spawn(process.execPath, [vite], {
  cwd: appDirectory,
  stdio: "inherit",
});

let desktop;
let stopping = false;

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
  renderer.kill("SIGTERM");
  desktop?.kill("SIGTERM");
}

try {
  await waitForRenderer();
  desktop = spawn(process.execPath, [electron, "."], {
    cwd: appDirectory,
    env: {
      ...process.env,
      LOCAL_STATUS_DEV_URL: "http://127.0.0.1:5173",
    },
    stdio: "inherit",
  });
  desktop.on("exit", () => stop());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stop();
  process.exitCode = 1;
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
