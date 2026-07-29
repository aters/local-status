import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function copyBundle(source, destination) {
  try {
    execFileSync("cp", ["-cR", source, destination], { stdio: "ignore" });
  } catch {
    rmSync(destination, { recursive: true, force: true });
    execFileSync("cp", ["-R", source, destination], { stdio: "ignore" });
  }
}

function setPlistValue(plistPath, key, value) {
  execFileSync(
    "/usr/libexec/PlistBuddy",
    ["-c", `Set :${key} ${value}`, plistPath],
    { stdio: "ignore" },
  );
}

export function prepareBrandedElectron() {
  const electronExecutable = require("electron");
  if (process.platform !== "darwin") return electronExecutable;

  const electronVersion = require("electron/package.json").version;
  const sourceBundle = resolve(dirname(electronExecutable), "../..");
  const cacheDirectory = join(
    appDirectory,
    "node_modules",
    ".cache",
    "local-status-electron",
    electronVersion,
  );
  const brandedBundle = join(cacheDirectory, "Local Status.app");
  const brandedExecutable = join(
    brandedBundle,
    "Contents",
    "MacOS",
    "Local Status",
  );
  if (existsSync(brandedExecutable)) return brandedExecutable;

  mkdirSync(cacheDirectory, { recursive: true });
  const temporaryBundle = join(
    cacheDirectory,
    `Local Status.app.build-${process.pid}`,
  );
  rmSync(temporaryBundle, { recursive: true, force: true });
  process.stdout.write("Preparing the Local Status desktop runtime…\n");

  try {
    copyBundle(sourceBundle, temporaryBundle);
    const contents = join(temporaryBundle, "Contents");
    renameSync(
      join(contents, "MacOS", "Electron"),
      join(contents, "MacOS", "Local Status"),
    );
    const plist = join(contents, "Info.plist");
    setPlistValue(plist, "CFBundleExecutable", "Local Status");
    setPlistValue(plist, "CFBundleName", "Local Status");
    setPlistValue(plist, "CFBundleDisplayName", "Local Status");
    setPlistValue(plist, "CFBundleIdentifier", "app.local-status.desktop");
    execFileSync("codesign", ["--remove-signature", temporaryBundle], {
      stdio: "ignore",
    });
    execFileSync(
      "codesign",
      ["--force", "--deep", "--sign", "-", temporaryBundle],
      { stdio: "ignore" },
    );
    renameSync(temporaryBundle, brandedBundle);
  } catch (error) {
    rmSync(temporaryBundle, { recursive: true, force: true });
    throw error;
  }

  return brandedExecutable;
}
