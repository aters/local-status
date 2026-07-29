// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectPackageRunner,
  discoverScripts,
} from "../electron/script-discovery.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("package script discovery", () => {
  it("detects the package manager and returns executable/argument arrays", async () => {
    const repository = mkdtempSync(join(tmpdir(), "local-status-scripts-"));
    temporaryDirectories.push(repository);
    writeFileSync(
      join(repository, "package.json"),
      JSON.stringify({ scripts: { dev: "vite", test: "vitest" } }),
    );
    writeFileSync(join(repository, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

    expect(await detectPackageRunner(repository)).toBe("pnpm");
    expect(await discoverScripts(repository)).toEqual([
      {
        name: "dev",
        runner: "pnpm",
        command: "pnpm",
        args: ["run", "dev"],
      },
      {
        name: "test",
        runner: "pnpm",
        command: "pnpm",
        args: ["run", "test"],
      },
    ]);
  });

  it("returns no scripts for non-Node repositories", async () => {
    const repository = mkdtempSync(join(tmpdir(), "local-status-no-scripts-"));
    temporaryDirectories.push(repository);
    mkdirSync(join(repository, "src"));
    await expect(discoverScripts(repository)).resolves.toEqual([]);
  });
});
