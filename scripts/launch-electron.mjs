import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareBrandedElectron } from "./electron-runtime.mjs";

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktop = spawn(prepareBrandedElectron(), [appDirectory], {
  cwd: appDirectory,
  env: process.env,
  stdio: "inherit",
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    desktop.kill(signal);
  });
}

desktop.on("exit", (code, signal) => {
  process.exitCode = code ?? (stopping && signal ? 0 : 1);
});

desktop.on("error", (error) => {
  console.error(`Local Status could not launch: ${error.message}`);
  process.exitCode = 1;
});
