import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { prepareBrandedElectron } from "../../scripts/electron-runtime.mjs";

const appDirectory = resolve(import.meta.dirname, "../..");
const electronPath = prepareBrandedElectron();
let fixtureParent: string;
let workspace: string;
let userData: string;
let desktopProcess: ChildProcess | null = null;

async function launchDesktop(port: number) {
  let stderr = "";
  desktopProcess = spawn(electronPath, ["."], {
    cwd: appDirectory,
    env: {
      ...process.env,
      LOCAL_STATUS_TEST_USER_DATA: userData,
      LOCAL_STATUS_E2E_PORT: String(port),
      LOCAL_STATUS_TEST_WORKSPACE: workspace,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  desktopProcess.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (desktopProcess.exitCode !== null) {
      throw new Error(`Electron exited before opening:\n${stderr}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        return chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      }
    } catch {
      // Electron is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Electron did not expose its test endpoint:\n${stderr}`);
}

test.beforeEach(() => {
  fixtureParent = mkdtempSync(join(tmpdir(), "local-status-quick-open-"));
  workspace = join(fixtureParent, "workspace");
  userData = join(fixtureParent, "user-data");
  mkdirSync(workspace);
  mkdirSync(userData);
  for (const repositoryName of ["api", "web app"]) {
    const repository = join(workspace, repositoryName);
    mkdirSync(repository);
    execFileSync("git", ["init", "-q", repository]);
  }
  mkdirSync(join(workspace, "web app", "src"));
  writeFileSync(
    join(workspace, "web app", "src", "Quick Search.tsx"),
    "export const quickSearch = true;\n",
  );
  writeFileSync(
    join(workspace, "api", "README.md"),
    "# API fixture\n\nSearchable Markdown content.\n",
  );
});

test.afterEach(async () => {
  if (desktopProcess && desktopProcess.exitCode === null) {
    desktopProcess.kill("SIGTERM");
  }
  desktopProcess = null;
  await rm(fixtureParent, { force: true, recursive: true });
});

test("opens workspace files and routes contextual Find", async ({}, testInfo) => {
  const browser = await launchDesktop(9441);
  const window = browser.contexts()[0].pages()[0];
  await window.setViewportSize({ width: 1440, height: 900 });
  await expect(window.getByText("web app").first()).toBeVisible();

  await window.keyboard.press("Meta+P");
  const palette = window.getByRole("dialog", { name: "Quick Open" });
  await expect(palette).toBeVisible();
  await palette.getByRole("searchbox", { name: "Search files" }).fill("quick");
  await expect(
    palette.getByRole("option", { name: /Quick Search\.tsx.*web app/i }),
  ).toBeVisible();
  await window.screenshot({
    path: testInfo.outputPath("quick-open-1440x900.png"),
  });
  await window.setViewportSize({ width: 1180, height: 760 });
  await window.screenshot({
    path: testInfo.outputPath("quick-open-1180x760.png"),
  });
  await window.keyboard.press("Enter");

  await expect(window.getByText("Quick Search.tsx").last()).toBeVisible();
  await window.keyboard.press("Meta+F");
  await expect(window.locator(".find-widget.visible")).toBeVisible();

  await window.getByRole("button", { name: "Services" }).click();
  await window.keyboard.press("Meta+P");
  await expect(window.getByRole("dialog", { name: "Quick Open" })).toBeVisible();
  await window.setViewportSize({ width: 900, height: 700 });
  await window.screenshot({
    path: testInfo.outputPath("quick-open-services-900x700.png"),
  });
  await browser.close();
});
