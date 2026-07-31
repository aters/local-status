import { chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);

function unpackedPath(path) {
  return path
    .replace("app.asar", "app.asar.unpacked")
    .replace("node_modules.asar", "node_modules.asar.unpacked");
}

export function nodePtyPackageRoot() {
  return resolve(dirname(require.resolve("node-pty")), "..");
}

export function ensureNodePtySpawnHelper({
  packageRoot = nodePtyPackageRoot(),
  platform = process.platform,
  architecture = process.arch,
} = {}) {
  if (platform === "win32") return null;

  const candidates = [
    join(packageRoot, "prebuilds", `${platform}-${architecture}`, "spawn-helper"),
    join(packageRoot, "build", "Release", "spawn-helper"),
  ].map(unpackedPath);
  const helper = candidates.find((candidate) => existsSync(candidate));
  if (!helper) {
    throw new Error(
      `The node-pty spawn helper is missing for ${platform}-${architecture}. Run npm install to restore native terminal support.`,
    );
  }

  const mode = statSync(helper).mode;
  if ((mode & 0o111) === 0) {
    try {
      chmodSync(helper, mode | 0o111);
    } catch (error) {
      throw new Error(
        `The node-pty spawn helper is not executable and Local Status could not repair its permissions: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }
  return helper;
}

export const __testing = { unpackedPath };
