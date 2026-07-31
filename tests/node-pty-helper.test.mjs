// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  __testing,
  ensureNodePtySpawnHelper,
} from "../electron/node-pty-helper.mjs";

const temporaryDirectories = [];

function temporaryPackage() {
  const root = mkdtempSync(join(tmpdir(), "local-status-node-pty-"));
  temporaryDirectories.push(root);
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("node-pty spawn helper", () => {
  it("repairs a non-executable helper for the current native target", () => {
    const packageRoot = temporaryPackage();
    const directory = join(packageRoot, "prebuilds", "darwin-arm64");
    const helper = join(directory, "spawn-helper");
    mkdirSync(directory, { recursive: true });
    writeFileSync(helper, "fixture", { mode: 0o644 });

    expect(
      ensureNodePtySpawnHelper({
        packageRoot,
        platform: "darwin",
        architecture: "arm64",
      }),
    ).toBe(helper);
    expect(statSync(helper).mode & 0o111).toBe(0o111);
  });

  it("reports a useful installation error when the helper is missing", () => {
    expect(() =>
      ensureNodePtySpawnHelper({
        packageRoot: temporaryPackage(),
        platform: "darwin",
        architecture: "arm64",
      }),
    ).toThrow(/spawn helper is missing.*npm install/i);
  });

  it("resolves helpers from unpacked Electron archives", () => {
    expect(
      __testing.unpackedPath(
        "/Applications/Local Status.app/Contents/Resources/app.asar/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
      ),
    ).toContain("app.asar.unpacked/node_modules/node-pty");
  });
});
