import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium, expect, test } from "@playwright/test";

const appDirectory = resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const electronPath = require("electron") as string;
let fixtureRoot: string;
let fixtureParent: string;
let userData: string;
let desktopProcess: ChildProcess | null = null;

async function launchDesktop(port: number, workspace: string | null = fixtureRoot) {
  let stderr = "";
  const environment = {
    ...process.env,
    LOCAL_STATUS_TEST_USER_DATA: userData,
    LOCAL_STATUS_E2E_PORT: String(port),
  };
  if (workspace) {
    environment.LOCAL_STATUS_TEST_WORKSPACE = workspace;
  } else {
    delete environment.LOCAL_STATUS_TEST_WORKSPACE;
  }
  desktopProcess = spawn(
    electronPath,
    ["."],
    {
      cwd: appDirectory,
      env: environment,
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  desktopProcess.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (desktopProcess.exitCode !== null) {
      throw new Error(`Electron exited before opening:\n${stderr}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      // Electron is still opening.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Electron did not expose its test endpoint:\n${stderr}`);
}

function git(directory: string, ...args: string[]) {
  execFileSync("git", ["-C", directory, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function seedRepository(repository: string, readme: string) {
  const message = "Initial fixture snapshot";
  const stream = [
    "blob",
    "mark :1",
    `data ${Buffer.byteLength(readme)}`,
    readme,
    "commit refs/heads/main",
    "mark :2",
    "author Local Status E2E <e2e@local-status.test> 1704067200 +0000",
    "committer Local Status E2E <e2e@local-status.test> 1704067200 +0000",
    `data ${Buffer.byteLength(message)}`,
    message,
    "M 100644 :1 README.md",
    "",
  ].join("\n");
  execFileSync("git", ["-C", repository, "fast-import", "--quiet"], {
    input: stream,
    stdio: ["pipe", "pipe", "pipe"],
  });
  git(repository, "read-tree", "HEAD");
}

test.beforeEach(() => {
  fixtureParent = mkdtempSync(join(tmpdir(), "local-status-e2e-"));
  fixtureRoot = join(fixtureParent, "engineering-workspace");
  mkdirSync(fixtureRoot);
  userData = mkdtempSync(join(tmpdir(), "local-status-e2e-user-data-"));
  const clean = join(fixtureRoot, "clean-api");
  const changed = join(fixtureRoot, "changed-web");
  execFileSync("git", ["init", "-b", "main", clean]);
  execFileSync("git", ["init", "-b", "main", changed]);
  for (const repository of [clean, changed]) {
    git(repository, "config", "user.email", "e2e@local-status.test");
    git(repository, "config", "user.name", "Local Status E2E");
    const readme = `# ${repository.split("/").pop()}\n`;
    seedRepository(repository, readme);
    writeFileSync(join(repository, "README.md"), readme);
  }
  writeFileSync(join(changed, "README.md"), "# changed-web\n\nLocal edit\n");
  writeFileSync(
    join(changed, "package.json"),
    JSON.stringify(
      {
        scripts: {
          service:
            "node -e \"console.log('fixture service ready'); setInterval(() => {}, 1000)\"",
        },
      },
      null,
      2,
    ),
  );
});

test.afterEach(async () => {
  if (desktopProcess && desktopProcess.exitCode === null) {
    desktopProcess.kill("SIGTERM");
  }
  desktopProcess = null;
  await Promise.all([
    rm(fixtureParent, { recursive: true, force: true }),
    rm(userData, { recursive: true, force: true }),
  ]);
});

test("renders first-run onboarding with readable display typography", async ({
}, testInfo) => {
  const browser = await launchDesktop(9334, null);
  const window = browser.contexts()[0].pages()[0];
  await window.setViewportSize({ width: 1180, height: 760 });

  const headline = window.getByRole("heading", {
    name: "Every repository, one clear view.",
  });
  await expect(headline).toBeVisible();
  const typography = await headline.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      family: style.fontFamily,
      kerning: style.fontKerning,
      letterSpacing: style.letterSpacing,
      lineHeight: style.lineHeight,
    };
  });
  expect(typography.family).toContain("-apple-system");
  expect(typography.kerning).toBe("normal");
  expect(Number.parseFloat(typography.letterSpacing)).toBeGreaterThan(-2);
  await window.screenshot({
    path: testInfo.outputPath("onboarding.png"),
    animations: "disabled",
  });
  await browser.close();
});

test("opens repositories, renders a side-by-side diff, and runs an interactive service", async () => {
  const browser = await launchDesktop(9333);
  const window = browser.contexts()[0].pages()[0];
  await window.setViewportSize({ width: 1440, height: 900 });

  await expect(window.getByText("changed-web").first()).toBeVisible();
  await window.getByText("changed-web").first().click();

  const contextPanel = window.locator(".context-panel");
  const runScriptButton = window.getByRole("button", {
    name: "Run a package script",
  });
  const [contextBox, runScriptBox] = await Promise.all([
    contextPanel.boundingBox(),
    runScriptButton.boundingBox(),
  ]);
  expect(contextBox).not.toBeNull();
  expect(runScriptBox).not.toBeNull();
  expect(runScriptBox!.x + runScriptBox!.width).toBeLessThanOrEqual(
    contextBox!.x + contextBox!.width,
  );

  await runScriptButton.click();
  await expect(window.getByRole("menu", { name: "Package scripts" })).toBeVisible();
  await expect(window.getByRole("menuitem", { name: /service npm/ })).toBeVisible();
  await window.getByRole("tab", { name: /Changes/ }).click();
  await expect(window.getByRole("menu", { name: "Package scripts" })).toBeHidden();

  await window.getByRole("button", { name: /README\.md/ }).click();
  await expect(window.locator(".monaco-diff-editor")).toBeVisible();
  await expect(window.locator(".monaco-diff-editor .editor")).toHaveCount(2);
  expect(
    await window.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  if (process.env.LOCAL_STATUS_CAPTURE_SCREENSHOTS === "1") {
    const screenshots = join(appDirectory, "docs", "screenshots");
    mkdirSync(screenshots, { recursive: true });
    await window.screenshot({
      path: join(screenshots, "repositories.png"),
      animations: "disabled",
    });
  }

  await window.getByRole("button", { name: "Services" }).click();
  await window.getByLabel("Repository for new service").selectOption("changed-web");
  await window.getByLabel("Package script").selectOption("service");
  await window.getByRole("button", { name: "Run script" }).click();
  await expect(window.locator(".terminal-stage")).toContainText("changed-web");
  await expect
    .poll(async () => window.locator(".xterm-screen").textContent())
    .toContain("fixture service ready");
  if (process.env.LOCAL_STATUS_CAPTURE_SCREENSHOTS === "1") {
    await window.screenshot({
      path: join(appDirectory, "docs", "screenshots", "services.png"),
      animations: "disabled",
    });
  }

  for (const size of [
    { width: 1180, height: 760 },
    { width: 900, height: 700 },
  ]) {
    await window.setViewportSize(size);
    await window.waitForTimeout(250);
    const layout = await window.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      overflowing: [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((element) => element.scrollWidth > element.clientWidth + 2)
        .slice(0, 8)
        .map((element) => ({
          className: element.className,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        })),
    }));
    expect(layout, `Horizontal overflow at ${size.width}px`).toMatchObject({
      document: layout.viewport,
    });
    await expect(window.locator(".terminal-stage")).toBeVisible();
  }

  await window.getByRole("button", { name: "Stop" }).click();
  await expect(window.getByRole("button", { name: "Restart" })).toBeVisible();
  await browser.close();
});
