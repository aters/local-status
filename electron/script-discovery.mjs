import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function detectPackageRunner(repositoryPath) {
  if (await exists(join(repositoryPath, "pnpm-lock.yaml"))) return "pnpm";
  if (
    (await exists(join(repositoryPath, "bun.lock"))) ||
    (await exists(join(repositoryPath, "bun.lockb")))
  ) {
    return "bun";
  }
  if (await exists(join(repositoryPath, "yarn.lock"))) return "yarn";
  return "npm";
}

function invocation(runner, scriptName) {
  if (runner === "yarn") return { command: "yarn", args: [scriptName] };
  return { command: runner, args: ["run", scriptName] };
}

export async function discoverScripts(repositoryPath) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(repositoryPath, "package.json"), "utf8"));
  } catch {
    return [];
  }
  if (!manifest?.scripts || typeof manifest.scripts !== "object") return [];
  const runner = await detectPackageRunner(repositoryPath);
  return Object.keys(manifest.scripts)
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({ name, runner, ...invocation(runner, name) }));
}
