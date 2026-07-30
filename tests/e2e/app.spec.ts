import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium, expect, test } from "@playwright/test";
import { prepareBrandedElectron } from "../../scripts/electron-runtime.mjs";

const appDirectory = resolve(import.meta.dirname, "../..");
const electronPath = prepareBrandedElectron();
let fixtureRoot: string;
let fixtureParent: string;
let userData: string;
let codexExecutable: string;
let githubExecutable: string;
let changedRepository: string;
let desktopProcess: ChildProcess | null = null;

async function launchDesktop(port: number, workspace: string | null = fixtureRoot) {
  let stderr = "";
  const environment = {
    ...process.env,
    LOCAL_STATUS_TEST_USER_DATA: userData,
    LOCAL_STATUS_E2E_PORT: String(port),
    LOCAL_STATUS_CODEX_PATH: codexExecutable,
    LOCAL_STATUS_GH_PATH: githubExecutable,
    LOCAL_STATUS_TEST_ACCEPT_AI_DISCLOSURE: "1",
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
      if (response.ok) {
        const browser = await chromium.connectOverCDP(
          `http://127.0.0.1:${port}`,
        );
        for (let pageAttempt = 0; pageAttempt < 50; pageAttempt += 1) {
          if (browser.contexts()[0]?.pages()[0]) return browser;
          await new Promise((resolvePromise) =>
            setTimeout(resolvePromise, 100),
          );
        }
        await browser.close();
      }
    } catch {
      // Electron is still opening.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Electron did not expose its test endpoint:\n${stderr}`);
}

async function stopDesktop() {
  if (!desktopProcess || desktopProcess.exitCode !== null) {
    desktopProcess = null;
    return;
  }
  const processToStop = desktopProcess;
  processToStop.kill("SIGTERM");
  await new Promise<void>((resolvePromise) => {
    const timeout = setTimeout(resolvePromise, 3_000);
    processToStop.once("exit", () => {
      clearTimeout(timeout);
      resolvePromise();
    });
  });
  desktopProcess = null;
}

function git(directory: string, ...args: string[]) {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
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
  codexExecutable = join(fixtureParent, "codex");
  githubExecutable = join(fixtureParent, "gh");
  writeFileSync(
    codexExecutable,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("codex-cli 9.9.9");
} else if (args[0] === "login" && args[1] === "status") {
  console.log("Logged in using ChatGPT");
} else {
  process.stdin.resume();
  process.stdin.on("end", () => {
    console.log(JSON.stringify({ message: "feat: generated fixture commit" }));
  });
}
`,
    { mode: 0o755 },
  );
  chmodSync(codexExecutable, 0o755);
  writeFileSync(
    githubExecutable,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("gh version 9.9.9");
} else if (args[0] === "auth" && args[1] === "status") {
  console.log(JSON.stringify({
    hosts: {
      "github.com": [{ active: true, state: "success", login: "dmytro" }]
    }
  }));
} else if (args[0] === "repo" && args[1] === "view") {
  const repository = process.cwd().split("/").pop();
  console.log(JSON.stringify({
    nameWithOwner: "fixture/" + repository,
    url: "https://github.com/fixture/" + repository
  }));
} else if (args[0] === "search" && args[1] === "prs") {
  const authored = [{
    author: { login: "dmytro" },
    isDraft: false,
    number: 12,
    repository: { nameWithOwner: "fixture/changed-web" },
    state: "open",
    title: "Refine repository workspace materials",
    updatedAt: "2026-07-29T08:30:00.000Z",
    url: "https://github.com/fixture/changed-web/pull/12"
  }];
  const reviews = [{
    author: { login: "octocat" },
    isDraft: true,
    number: 7,
    repository: { nameWithOwner: "fixture/clean-api" },
    state: "open",
    title: "Document the local API workflow",
    updatedAt: "2026-07-28T06:15:00.000Z",
    url: "https://github.com/fixture/clean-api/pull/7"
  }];
  console.log(JSON.stringify(args.includes("--author") ? authored : reviews));
}
`,
    { mode: 0o755 },
  );
  chmodSync(githubExecutable, 0o755);
  const clean = join(fixtureRoot, "clean-api");
  changedRepository = join(fixtureRoot, "changed-web");
  execFileSync("git", ["init", "-b", "main", clean]);
  execFileSync("git", ["init", "-b", "main", changedRepository]);
  for (const repository of [clean, changedRepository]) {
    git(repository, "config", "user.email", "e2e@local-status.test");
    git(repository, "config", "user.name", "Local Status E2E");
    const readme = `# ${repository.split("/").pop()}\n`;
    seedRepository(repository, readme);
    writeFileSync(join(repository, "README.md"), readme);
  }
  const remote = join(fixtureParent, "changed-remote.git");
  const producer = join(fixtureParent, "changed-producer");
  execFileSync("git", ["init", "--bare", remote], { stdio: "ignore" });
  git(changedRepository, "remote", "add", "origin", remote);
  git(changedRepository, "push", "-u", "origin", "main");
  git(remote, "symbolic-ref", "HEAD", "refs/heads/main");
  execFileSync("git", ["clone", remote, producer], { stdio: "ignore" });
  git(producer, "config", "user.email", "e2e@local-status.test");
  git(producer, "config", "user.name", "Local Status E2E");
  writeFileSync(join(producer, "remote-update.md"), "# Remote update\n");
  git(producer, "add", "remote-update.md");
  git(producer, "commit", "-m", "Remote fixture update");
  git(producer, "push", "origin", "main");
  git(changedRepository, "fetch", "origin");
  writeFileSync(
    join(changedRepository, "README.md"),
    "# changed-web\n\nLocal edit\n",
  );
  writeFileSync(
    join(changedRepository, "package.json"),
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
  await stopDesktop();
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
  const onboardingLogo = window.locator("img.onboarding-mark");
  await expect(onboardingLogo).toBeVisible();
  expect(
    await onboardingLogo.evaluate(
      (image) => (image as HTMLImageElement).naturalWidth,
    ),
  ).toBeGreaterThan(0);
  expect(
    await window.locator('link[rel="icon"]').getAttribute("href"),
  ).toContain("favicon.png");
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

test("renders a cohesive light theme across repository surfaces", async ({
}, testInfo) => {
  const browser = await launchDesktop(9335);
  const window = browser.contexts()[0].pages()[0];
  await window.setViewportSize({ width: 1440, height: 900 });

  await window.getByRole("button", { name: "Settings" }).click();
  await window.getByRole("radio", { name: /Light/ }).click();
  await expect(window.locator("html")).toHaveAttribute("data-theme", "light");
  await window.getByRole("button", { name: "Repositories" }).click();
  await window.getByText("changed-web").first().click();
  await expect(window.getByRole("heading", { name: "changed-web" })).toBeVisible();

  const colors = await window.evaluate(() => {
    const background = (selector: string) =>
      getComputedStyle(document.querySelector<HTMLElement>(selector)!).backgroundColor;
    const foreground = (selector: string) =>
      getComputedStyle(document.querySelector<HTMLElement>(selector)!).color;
    return {
      header: background(".app-header"),
      navigation: background(".app-nav"),
      activeNavigation: background(".app-nav button.is-active"),
      summary: background(".overview-stats"),
      repositories: background(".repo-panel"),
      changes: background(".context-panel"),
      viewer: background(".viewer-empty"),
      viewerHeading: foreground(".viewer-empty h2"),
    };
  });

  expect(colors).toMatchObject({
    header: "rgba(255, 255, 255, 0.94)",
    navigation: "rgb(247, 249, 248)",
    activeNavigation: "rgb(229, 243, 237)",
    summary: "rgb(247, 249, 248)",
    repositories: "rgb(255, 255, 255)",
    changes: "rgb(255, 255, 255)",
    viewer: "rgb(247, 249, 248)",
    viewerHeading: "rgb(24, 33, 29)",
  });

  await window.screenshot({
    path: testInfo.outputPath("light-theme.png"),
    animations: "disabled",
  });
  await browser.close();
});

test("renders a cohesive dark theme across repository surfaces", async ({
}, testInfo) => {
  const browser = await launchDesktop(9336);
  const window = browser.contexts()[0].pages()[0];
  await window.setViewportSize({ width: 1440, height: 900 });

  await window.getByRole("button", { name: "Settings" }).click();
  await window.getByRole("radio", { name: /Dark/ }).click();
  await expect(window.locator("html")).toHaveAttribute("data-theme", "dark");
  await window.getByRole("button", { name: "Repositories" }).click();
  await window.getByText("changed-web").first().click();
  await expect(window.getByRole("heading", { name: "changed-web" })).toBeVisible();

  const colors = await window.evaluate(() => {
    const background = (selector: string) =>
      getComputedStyle(document.querySelector<HTMLElement>(selector)!).backgroundColor;
    const foreground = (selector: string) =>
      getComputedStyle(document.querySelector<HTMLElement>(selector)!).color;
    return {
      header: background(".app-header"),
      navigation: background(".app-nav"),
      activeNavigation: background(".app-nav button.is-active"),
      summary: background(".overview-stats"),
      repositories: background(".repo-panel"),
      changes: background(".context-panel"),
      viewer: background(".viewer-empty"),
      viewerHeading: foreground(".viewer-empty h2"),
    };
  });

  expect(colors).toMatchObject({
    header: "rgba(29, 29, 29, 0.94)",
    navigation: "rgb(35, 35, 35)",
    activeNavigation: "rgb(29, 49, 40)",
    summary: "rgb(35, 35, 35)",
    repositories: "rgb(29, 29, 29)",
    changes: "rgb(29, 29, 29)",
    viewer: "rgb(35, 35, 35)",
    viewerHeading: "rgb(241, 241, 241)",
  });

  await window.screenshot({
    path: testInfo.outputPath("dark-theme.png"),
    animations: "disabled",
  });

  await window.locator('.change-row__select[title="README.md"]').click();
  const darkEditor = window.locator(".monaco-diff-editor .editor");
  await expect(darkEditor).toHaveCount(2);
  await expect(
    window.locator(".editor.original .lines-content.monaco-editor-background"),
  ).toHaveCSS("background-color", "rgb(23, 23, 23)");
  await window.screenshot({
    path: testInfo.outputPath("dark-diff.png"),
    animations: "disabled",
  });
  await browser.close();
});

test("renders and persists the Glass and Neumorphic theme systems", async ({
}, testInfo) => {
  test.setTimeout(90_000);
  let browser = await launchDesktop(9337);
  let window = browser.contexts()[0].pages()[0];
  await window.setViewportSize({ width: 1440, height: 900 });

  await window.getByRole("button", { name: "Settings" }).click();
  await expect(window.getByRole("radio")).toHaveCount(5);
  await window.getByRole("radio", { name: /Glass/ }).click();
  await expect(window.locator("html")).toHaveAttribute("data-theme", "glass");
  await expect(window.locator("html")).toHaveAttribute("data-material", "glass");
  await expect(window.locator("html")).toHaveAttribute("data-layout", "floating");
  expect(await window.locator("html").evaluate((element) => element.style.colorScheme))
    .toBe("dark");
  await window.screenshot({
    path: testInfo.outputPath("glass-settings.png"),
    animations: "disabled",
  });
  const themeCardRows = await window.locator(".theme-card").evaluateAll((cards) =>
    cards.map((card) => Math.round(card.getBoundingClientRect().top)),
  );
  expect(new Set(themeCardRows).size).toBe(1);

  await window.getByRole("button", { name: "Repositories" }).click();
  await window.getByText("changed-web").first().click();
  await expect(window.getByRole("heading", { name: "changed-web" })).toBeVisible();
  const glassLayout = await window.evaluate(() => {
    const style = (selector: string) =>
      getComputedStyle(document.querySelector<HTMLElement>(selector)!);
    const panels = [
      ".repo-panel",
      ".context-panel",
      ".viewer-panel",
    ].map((selector) =>
      document.querySelector<HTMLElement>(selector)!.getBoundingClientRect(),
    );
    return {
      headerRadius: style(".app-header").borderRadius,
      panelRadius: style(".repo-panel").borderRadius,
      panelBackground: style(".repo-panel").backgroundColor,
      panelGaps: [panels[1].left - panels[0].right, panels[2].left - panels[1].right],
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
    };
  });
  expect(Number.parseFloat(glassLayout.headerRadius)).toBeGreaterThan(0);
  expect(Number.parseFloat(glassLayout.panelRadius)).toBeGreaterThan(0);
  expect(glassLayout.panelBackground).toMatch(/^rgba\(/);
  expect(glassLayout.panelGaps.every((gap) => gap > 0)).toBe(true);
  expect(glassLayout.document).toBe(glassLayout.viewport);
  const glassContextMaterials = await window.evaluate(() => {
    const selectors = [
      ".repository-header",
      ".context-tabs",
      ".context-tabs button.is-active",
      ".commit-toolbar",
      ".context-search",
      ".context-content",
      ".change-group__header",
      ".change-action",
    ];
    return selectors.map((selector) => {
      const style = getComputedStyle(
        document.querySelector<HTMLElement>(selector)!,
      );
      return {
        selector,
        radius: Number.parseFloat(style.borderRadius),
        border: Number.parseFloat(style.borderTopWidth),
        background: style.backgroundColor,
        shadow: style.boxShadow,
      };
    });
  });
  for (const surface of glassContextMaterials) {
    expect(surface.radius, surface.selector).toBeGreaterThan(0);
    expect(surface.border, surface.selector).toBeGreaterThan(0);
    expect(surface.background, surface.selector).not.toBe("rgba(0, 0, 0, 0)");
  }
  expect(
    glassContextMaterials.find(({ selector }) => selector === ".context-tabs")
      ?.shadow,
  ).toContain("inset");
  await window.screenshot({
    path: testInfo.outputPath("glass-workspace.png"),
    animations: "disabled",
  });

  await window.locator(".workspace-switcher").click();
  await expect(
    window.getByRole("menu", { name: "Switch workspace" }),
  ).toBeVisible();
  await window.screenshot({
    path: testInfo.outputPath("glass-workspace-menu.png"),
    animations: "disabled",
  });
  await window.keyboard.press("Escape");

  await window.getByRole("button", { name: "Run a package script" }).click();
  await expect(
    window.getByRole("menu", { name: "Package scripts" }),
  ).toBeVisible();
  await window.screenshot({
    path: testInfo.outputPath("glass-script-picker.png"),
    animations: "disabled",
  });
  await window.getByRole("button", { name: "Run a package script" }).click();

  await window.locator(".repository-header__branch").click();
  await expect(
    window.getByRole("dialog", { name: "Switch branch for changed-web" }),
  ).toBeVisible();
  await window.screenshot({
    path: testInfo.outputPath("glass-branch-picker.png"),
    animations: "disabled",
  });
  await window.keyboard.press("Escape");

  await window.getByRole("button", { name: "Stage README.md" }).click();
  await window.getByRole("button", { name: "Commit", exact: true }).click();
  const glassCommitDialog = window.getByRole("dialog", {
    name: "Commit staged changes",
  });
  await expect(glassCommitDialog).toBeVisible();
  await window.screenshot({
    path: testInfo.outputPath("glass-commit-modal.png"),
    animations: "disabled",
  });
  await glassCommitDialog
    .getByRole("button", { name: "Close commit window" })
    .click();
  await window.getByRole("button", { name: "Unstage README.md" }).click();

  await window.keyboard.press("ControlOrMeta+P");
  await expect(window.getByRole("dialog", { name: "Quick Open" })).toBeVisible();
  await window.screenshot({
    path: testInfo.outputPath("glass-quick-open.png"),
    animations: "disabled",
  });
  await window.keyboard.press("Escape");

  await window.getByRole("button", { name: "Settings" }).click();
  await window.getByRole("radio", { name: /Neumorphic/ }).click();
  await expect(window.locator("html")).toHaveAttribute(
    "data-theme",
    "neumorphic",
  );
  await expect(window.locator("html")).toHaveAttribute(
    "data-material",
    "neumorphic",
  );
  await expect(window.locator("html")).toHaveAttribute(
    "data-layout",
    "sculpted",
  );
  await window.screenshot({
    path: testInfo.outputPath("neumorphic-settings.png"),
    animations: "disabled",
  });

  await window.getByRole("button", { name: "Repositories" }).click();
  await window.getByText("changed-web").first().click();
  const neumorphicLayout = await window.evaluate(() => {
    const workspace = getComputedStyle(
      document.querySelector<HTMLElement>(".repository-workspace")!,
    );
    const viewer = getComputedStyle(
      document.querySelector<HTMLElement>(".viewer-panel")!,
    );
    return {
      workspaceShadow: workspace.boxShadow,
      viewerShadow: viewer.boxShadow,
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
    };
  });
  expect(neumorphicLayout.workspaceShadow).not.toBe("none");
  expect(neumorphicLayout.viewerShadow).toContain("inset");
  expect(neumorphicLayout.document).toBe(neumorphicLayout.viewport);
  const neumorphicContextMaterials = await window.evaluate(() => {
    const style = (selector: string) =>
      getComputedStyle(document.querySelector<HTMLElement>(selector)!);
    return {
      headerShadow: style(".repository-header").boxShadow,
      tabsShadow: style(".context-tabs").boxShadow,
      activeTabShadow: style(".context-tabs button.is-active").boxShadow,
      contentShadow: style(".context-content").boxShadow,
      groupShadow: style(".change-group__header").boxShadow,
      actionShadow: style(".change-action").boxShadow,
      activeTabBorder: style(".context-tabs button.is-active").borderTopColor,
    };
  });
  expect(neumorphicContextMaterials.headerShadow).not.toBe("none");
  expect(neumorphicContextMaterials.tabsShadow).toContain("inset");
  expect(neumorphicContextMaterials.activeTabShadow).toContain("inset");
  expect(neumorphicContextMaterials.contentShadow).toContain("inset");
  expect(neumorphicContextMaterials.groupShadow).not.toBe("none");
  expect(neumorphicContextMaterials.actionShadow).not.toBe("none");
  expect(neumorphicContextMaterials.activeTabBorder).not.toBe(
    "rgba(0, 0, 0, 0)",
  );
  await window.screenshot({
    path: testInfo.outputPath("neumorphic-workspace.png"),
    animations: "disabled",
  });
  await window.locator('.change-row__select[title="README.md"]').click();
  await expect(window.locator(".monaco-diff-editor")).toBeVisible();
  await expect(
    window.locator(".editor.original .lines-content.monaco-editor-background"),
  ).toHaveCSS("background-color", "rgb(16, 25, 34)");
  await window.screenshot({
    path: testInfo.outputPath("neumorphic-diff.png"),
    animations: "disabled",
  });

  await window.getByRole("button", { name: "Stage README.md" }).click();
  await window.getByRole("button", { name: "Commit", exact: true }).click();
  const neumorphicCommitDialog = window.getByRole("dialog", {
    name: "Commit staged changes",
  });
  await expect(neumorphicCommitDialog).toBeVisible();
  const aiSettingsButton = neumorphicCommitDialog.getByRole("button", {
    name: "AI draft settings",
  });
  await expect(aiSettingsButton).toBeEnabled();
  await aiSettingsButton.click();
  await expect(
    neumorphicCommitDialog.getByRole("dialog", {
      name: "AI draft settings",
    }),
  ).toBeVisible();
  await window.screenshot({
    path: testInfo.outputPath("neumorphic-commit-modal.png"),
    animations: "disabled",
  });
  await aiSettingsButton.click();
  await neumorphicCommitDialog
    .getByRole("button", { name: "Close commit window" })
    .click();
  await window.getByRole("button", { name: "Unstage README.md" }).click();

  await window.getByRole("button", { name: "Pull Requests" }).click();
  await expect(window.locator(".pull-requests-content")).toBeVisible();
  await expect(window.locator(".pull-request-sections")).toBeVisible();
  await expect(window.locator(".pull-request-row")).toHaveCount(2);
  await window.screenshot({
    path: testInfo.outputPath("neumorphic-pull-requests.png"),
    animations: "disabled",
  });

  await window.getByRole("button", { name: "Services" }).click();
  await expect(window.locator(".services-workspace")).toBeVisible();
  await window.screenshot({
    path: testInfo.outputPath("neumorphic-services.png"),
    animations: "disabled",
  });

  for (const size of [
    { width: 1180, height: 760 },
    { width: 900, height: 700 },
    { width: 390, height: 844 },
  ]) {
    await window.setViewportSize(size);
    await expect
      .poll(() =>
        window.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        ),
      )
      .toBeLessThanOrEqual(0);
    await window.getByRole("button", { name: "Repositories" }).click();
    await expect
      .poll(() =>
        window.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        ),
      )
      .toBeLessThanOrEqual(0);
    await window.getByRole("button", { name: "Services" }).click();
  }
  await window.screenshot({
    path: testInfo.outputPath("neumorphic-mobile-services.png"),
    animations: "disabled",
  });

  await browser.close();
  await stopDesktop();

  browser = await launchDesktop(9338);
  window = browser.contexts()[0].pages()[0];
  await expect(window.locator("html")).toHaveAttribute(
    "data-theme",
    "neumorphic",
  );
  await expect(window.locator("html")).toHaveAttribute(
    "data-layout",
    "sculpted",
  );
  await browser.close();
});

test("opens repositories, renders a side-by-side diff, and runs an interactive service", async ({
}, testInfo) => {
  const browser = await launchDesktop(9333);
  const window = browser.contexts()[0].pages()[0];
  await window.setViewportSize({ width: 1440, height: 900 });

  await expect(window.getByText("changed-web").first()).toBeVisible();
  const headerLogo = window.locator("img.brand-mark");
  await expect(headerLogo).toBeVisible();
  expect(
    await headerLogo.evaluate((image) => (image as HTMLImageElement).naturalWidth),
  ).toBeGreaterThan(0);
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

  await window.locator('.change-row__select[title="README.md"]').click();
  await expect(window.locator(".monaco-diff-editor")).toBeVisible();
  await expect(window.locator(".monaco-diff-editor .editor")).toHaveCount(2);

  await window.getByRole("button", { name: "Preview" }).click();
  await expect(window.locator(".markdown-preview")).toBeVisible();
  await expect(
    window.locator(".markdown-preview").getByRole("heading", { name: "changed-web" }),
  ).toBeVisible();
  await expect(window.locator(".monaco-diff-editor")).toBeHidden();
  await window.screenshot({
    path: testInfo.outputPath("markdown-preview.png"),
    animations: "disabled",
  });
  await window.getByRole("button", { name: "Source" }).click();
  await expect(window.locator(".monaco-diff-editor")).toBeVisible();

  await window.getByRole("button", { name: "Stage README.md" }).click();
  await expect(window.getByRole("button", { name: "Unstage README.md" })).toBeVisible();
  await window.getByRole("button", { name: "Unstage README.md" }).click();
  await expect(window.getByRole("button", { name: "Stage README.md" })).toBeVisible();

  await window.locator('.change-row__select[title="README.md"]').click();
  await window.keyboard.down("Shift");
  await window.locator('.change-row__select[title="package.json"]').click();
  await window.keyboard.up("Shift");
  await expect(window.locator(".change-row.is-selected")).toHaveCount(2);
  await window
    .getByRole("button", { name: "Stage 2 selected files" })
    .first()
    .click();
  await expect(
    window.getByRole("button", { name: "Unstage README.md" }),
  ).toBeVisible();

  await window.locator('.change-row__select[title="README.md"]').click();
  await window.keyboard.down("Shift");
  await window.locator('.change-row__select[title="package.json"]').click();
  await window.keyboard.up("Shift");
  await window
    .getByRole("button", { name: "Unstage 2 selected files" })
    .last()
    .click();
  await expect(window.getByRole("button", { name: "Stage README.md" })).toBeVisible();

  await window.getByRole("button", { name: "Stash", exact: true }).click();
  const stashDialog = window.getByRole("dialog", { name: "Stash changes" });
  await expect(stashDialog).toBeVisible();
  await expect(
    stashDialog.getByRole("checkbox", { name: /Include untracked files/ }),
  ).toBeChecked();
  await stashDialog.getByPlaceholder("What are you saving?").fill("before remote sync");
  await stashDialog.getByRole("button", { name: "Stash changes" }).click();
  await expect(window.getByRole("button", { name: "View stash" })).toBeVisible();
  await window.getByRole("button", { name: "View stash" }).click();

  const stashRow = window.getByRole("button", { name: /before remote sync/ });
  await expect(stashRow).toBeVisible();
  await expect(window.getByRole("heading", { name: "before remote sync" })).toBeVisible();
  await window.screenshot({
    path: testInfo.outputPath("stash-detail.png"),
    animations: "disabled",
  });
  await window.getByRole("button", { name: /README\.md/ }).last().click();
  await expect(window.locator(".monaco-diff-editor")).toBeVisible();
  await stashRow.click();
  await window.getByRole("button", { name: "Pop" }).click();
  await expect(window.getByText("Popped stash@{0}.")).toBeVisible();
  await window.getByRole("tab", { name: /Changes/ }).click();
  await expect(window.getByRole("button", { name: "Stage README.md" })).toBeVisible();

  await window
    .getByRole("button", { name: "Sync changes: 1 incoming, 0 outgoing" })
    .click();
  await expect(
    window.getByRole("button", { name: "Sync changes: 0 incoming, 0 outgoing" }),
  ).toBeVisible();
  await expect(window.getByText("Synced changed-web: pulled 1.")).toBeVisible();

  await window.getByRole("button", { name: "Stage README.md" }).click();
  await window.getByRole("button", { name: "Commit" }).click();
  const commitDialog = window.getByRole("dialog", {
    name: "Commit staged changes",
  });
  await expect(commitDialog).toBeVisible();
  await expect(commitDialog.getByText("README.md")).toBeVisible();
  await commitDialog
    .getByRole("button", { name: "Generate with Codex" })
    .click();
  const commitMessage = commitDialog.getByRole("textbox", {
    name: "Commit message",
  });
  await expect(commitMessage).toHaveValue("feat: generated fixture commit");
  await window.screenshot({
    path: testInfo.outputPath("commit-modal.png"),
    animations: "disabled",
  });
  await commitMessage.fill("feat: review and commit the local change");
  await commitDialog
    .getByRole("button", { name: "Commit", exact: true })
    .click();
  await expect(
    window.getByText(
      /Committed [0-9a-f]{7}: feat: review and commit the local change/,
    ),
  ).toBeVisible();
  expect(git(changedRepository, "log", "-1", "--format=%s")).toBe(
    "feat: review and commit the local change",
  );
  expect(git(changedRepository, "status", "--porcelain")).toContain(
    "?? package.json",
  );

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
