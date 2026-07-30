// @vitest-environment node
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AiRunner, __testing } from "../electron/codex-runner.mjs";
import { SettingsStore } from "../electron/settings-store.mjs";

const temporaryDirectories = [];

function temporaryDirectory(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function fakeCodex(directory) {
  const executable = join(directory, "codex");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("codex-cli 9.9.9");
  process.exit(0);
}
if (args[0] === "login" && args[1] === "status") {
  if (process.env.FAKE_CODEX_SIGNED_OUT === "1") process.exit(1);
  console.log("Logged in using ChatGPT");
  process.exit(0);
}
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { prompt += chunk; });
process.stdin.on("end", () => {
  if (process.env.FAKE_CODEX_PROMPT) fs.writeFileSync(process.env.FAKE_CODEX_PROMPT, prompt);
  if (process.env.FAKE_CODEX_ARGS) fs.writeFileSync(process.env.FAKE_CODEX_ARGS, JSON.stringify(args));
  if (process.env.FAKE_CODEX_HANG === "1") return setInterval(() => {}, 1000);
  if (process.env.FAKE_CODEX_INVALID === "1") return console.log("not json");
  console.log(JSON.stringify({ message: "feat: draft staged change" }));
});
`,
    { mode: 0o755 },
  );
  chmodSync(executable, 0o755);
  return executable;
}

function fakeClaude(directory) {
  const executable = join(directory, "claude");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("2.1.999 (Claude Code)");
  process.exit(0);
}
if (args[0] === "auth" && args[1] === "status") {
  console.log(JSON.stringify({
    loggedIn: process.env.FAKE_CLAUDE_SIGNED_OUT !== "1",
    authMethod: process.env.FAKE_CLAUDE_SIGNED_OUT === "1" ? "none" : "claude.ai"
  }));
  process.exit(0);
}
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { prompt += chunk; });
process.stdin.on("end", () => {
  if (process.env.FAKE_CLAUDE_PROMPT) fs.writeFileSync(process.env.FAKE_CLAUDE_PROMPT, prompt);
  if (process.env.FAKE_CLAUDE_ARGS) fs.writeFileSync(process.env.FAKE_CLAUDE_ARGS, JSON.stringify(args));
  if (process.env.FAKE_CLAUDE_ERROR === "1") {
    console.log(JSON.stringify({ is_error: true, result: "Not logged in · Please run /login" }));
    process.exit(1);
  }
  console.log(JSON.stringify({ structured_output: { message: "fix: draft with claude" } }));
});
`,
    { mode: 0o755 },
  );
  chmodSync(executable, 0o755);
  return executable;
}

async function createRunner(environment = {}) {
  const directory = temporaryDirectory("local-status-codex-");
  const settingsStore = new SettingsStore(join(directory, "settings.json"));
  await settingsStore.load();
  const executable = fakeCodex(directory);
  const claudeExecutable = fakeClaude(directory);
  const runnerEnvironment = {
    ...process.env,
    LOCAL_STATUS_CODEX_PATH: executable,
    LOCAL_STATUS_CLAUDE_PATH: claudeExecutable,
    ...environment,
  };
  const runner = new AiRunner({
    settingsStore,
    schemaPath: resolve("electron/commit-message.schema.json"),
    temporaryDirectory: directory,
    environment: runnerEnvironment,
    homeDirectory: directory,
  });
  return {
    directory,
    executable,
    claudeExecutable,
    runner,
    runnerEnvironment,
    settingsStore,
  };
}

const context = {
  repositoryId: "product-web",
  snapshotId: "a".repeat(64),
  branch: "main",
  detached: false,
  unborn: false,
  stagedFiles: [
    {
      status: "M",
      kind: "modified",
      path: "src/App.tsx",
      previousPath: null,
    },
  ],
  statistics: " src/App.tsx | 2 +-",
  recentSubjects: ["Keep messages concise"],
  patch: "diff --git a/src/App.tsx b/src/App.tsx\n+safe staged line\n",
  patchTruncated: false,
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("AiRunner", () => {
  it("detects authenticated Codex and generates from supplied staged context", async () => {
    const promptPath = join(tmpdir(), `local-status-prompt-${Date.now()}`);
    const argsPath = join(tmpdir(), `local-status-args-${Date.now()}`);
    temporaryDirectories.push(promptPath, argsPath);
    const { runner, settingsStore } = await createRunner({
      FAKE_CODEX_PROMPT: promptPath,
      FAKE_CODEX_ARGS: argsPath,
    });

    expect(await runner.status()).toMatchObject({
      provider: "codex",
      model: "gpt-5.6-luna",
      disclosureAccepted: false,
      providers: {
        codex: {
          available: true,
          authenticated: true,
          version: expect.stringContaining("codex-cli 9.9.9"),
        },
        claude: {
          available: true,
          authenticated: true,
        },
      },
    });
    await settingsStore.acceptAiDisclosure("codex");
    await expect(
      runner.generate("request-123", context),
    ).resolves.toEqual({
      message: "feat: draft staged change",
      snapshotId: "a".repeat(64),
      patchTruncated: false,
      provider: "codex",
      model: "gpt-5.6-luna",
    });

    const prompt = readFileSync(promptPath, "utf8");
    expect(prompt).toContain("src/App.tsx");
    expect(prompt).toContain("safe staged line");
    expect(prompt).toContain("Keep messages concise");
    expect(prompt).toContain("Do not run commands");
    expect(JSON.parse(readFileSync(argsPath, "utf8"))).toEqual([
      "--ask-for-approval",
      "never",
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--config",
      'model_reasoning_effort="none"',
      "--model",
      "gpt-5.6-luna",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--output-schema",
      resolve("electron/commit-message.schema.json"),
      "-",
    ]);
  });

  it("automatically locates and saves an existing CLI executable", async () => {
    const { executable, runner, settingsStore } = await createRunner();
    const canonicalExecutable = realpathSync(executable);

    await expect(runner.findAndSetExecutable("codex")).resolves.toMatchObject({
      providers: {
        codex: {
          available: true,
          executablePath: canonicalExecutable,
        },
      },
    });
    expect(settingsStore.aiSettings().executablePaths.codex).toBe(
      canonicalExecutable,
    );
  });

  it("returns null when an existing CLI executable cannot be found", async () => {
    const directory = temporaryDirectory("local-status-missing-codex-");
    const settingsStore = new SettingsStore(join(directory, "settings.json"));
    await settingsStore.load();
    const runner = new AiRunner({
      settingsStore,
      schemaPath: resolve("electron/commit-message.schema.json"),
      temporaryDirectory: directory,
      environment: { PATH: "" },
      homeDirectory: directory,
      runFile: async () => {
        throw new Error("Executable unavailable");
      },
    });

    await expect(runner.findAndSetExecutable("codex")).resolves.toBeNull();
    expect(settingsStore.aiSettings().executablePaths.codex).toBeNull();
  });

  it("reports signed-out and invalid-output failures without exposing credentials", async () => {
    const signedOut = await createRunner({ FAKE_CODEX_SIGNED_OUT: "1" });
    expect(await signedOut.runner.status()).toMatchObject({
      providers: {
        codex: {
          available: true,
          authenticated: false,
        },
      },
    });

    const invalid = await createRunner({ FAKE_CODEX_INVALID: "1" });
    await invalid.settingsStore.acceptAiDisclosure("codex");
    await expect(
      invalid.runner.generate("request-invalid", context),
    ).rejects.toThrow("Unexpected token");
  });

  it("cancels an active generation", async () => {
    const { runner, settingsStore } = await createRunner({
      FAKE_CODEX_HANG: "1",
    });
    await settingsStore.acceptAiDisclosure("codex");
    const generation = runner.generate("request-cancel", context);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 80));
    expect(runner.cancel("request-cancel")).toBe(true);
    await expect(generation).rejects.toThrow("cancelled");
  });

  it("surfaces the useful Codex parser error instead of the trailing help hint", () => {
    expect(
      __testing.cliErrorDetail(`warning: ignored setting
error: unexpected argument '--removed-flag' found

For more information, try '--help'.`, "Codex"),
    ).toBe("error: unexpected argument '--removed-flag' found");
  });

  it("extracts the message from a multiline structured CLI error", () => {
    expect(
      __testing.cliErrorDetail(`ERROR: {
  "type": "error",
  "error": {
    "code": "unsupported_value",
    "message": "Unsupported reasoning effort for this model."
  },
  "status": 400
}`, "Codex"),
    ).toBe("Unsupported reasoning effort for this model.");
  });

  it("reads Claude authentication state from JSON even when the CLI exits successfully", async () => {
    const signedOut = await createRunner({ FAKE_CLAUDE_SIGNED_OUT: "1" });

    expect(await signedOut.runner.status()).toMatchObject({
      providers: {
        claude: {
          available: true,
          authenticated: false,
          error: "Claude CLI is installed but not signed in.",
        },
      },
    });
  });

  it("surfaces structured Claude failures written to stdout", async () => {
    const { runner, settingsStore } = await createRunner({
      FAKE_CLAUDE_ERROR: "1",
    });
    await settingsStore.setAiPreferences("claude", "haiku");
    await settingsStore.acceptAiDisclosure("claude");

    await expect(
      runner.generate("request-claude-error", context),
    ).rejects.toThrow(
      "Claude CLI is not signed in. Complete sign-in and try again.",
    );
  });

  it("normalizes Claude subject/body objects instead of exposing JSON as the commit message", () => {
    const nested = JSON.stringify({
      structured_output: {
        message: JSON.stringify({
          subject: "feat: add Claude setup",
          body: "Open installation and sign-in inside a managed terminal.",
        }),
      },
    });
    const direct = JSON.stringify({
      structured_output: {
        subject: "fix: preserve terminal focus",
        body: "Keep repository shortcuts from intercepting terminal input.",
      },
    });

    expect(__testing.parseGeneratedMessage("claude", nested)).toBe(
      "feat: add Claude setup\n\nOpen installation and sign-in inside a managed terminal.",
    );
    expect(__testing.parseGeneratedMessage("claude", direct)).toBe(
      "fix: preserve terminal focus\n\nKeep repository shortcuts from intercepting terminal input.",
    );
  });

  it("uses provider-specific default model choices", () => {
    expect(__testing.DEFAULT_MODELS).toEqual({
      codex: "gpt-5.6-luna",
      claude: "haiku",
    });
  });

  it("checks macOS app bundles when locating Codex", () => {
    const candidates = __testing.executableCandidates(
      "codex",
      { executablePaths: { codex: null, claude: null } },
      { PATH: "" },
      "/Users/example",
    );

    expect(candidates).toContain(
      "/Applications/ChatGPT.app/Contents/Resources/codex",
    );
    expect(candidates).toContain(
      "/Users/example/Applications/ChatGPT.app/Contents/Resources/codex",
    );
    expect(candidates).toContain(
      "/Applications/Codex.app/Contents/Resources/codex",
    );
  });

  it("generates with Claude using no tools and structured ephemeral output", async () => {
    const promptPath = join(tmpdir(), `local-status-claude-prompt-${Date.now()}`);
    const argsPath = join(tmpdir(), `local-status-claude-args-${Date.now()}`);
    temporaryDirectories.push(promptPath, argsPath);
    const { runner, settingsStore } = await createRunner({
      FAKE_CLAUDE_PROMPT: promptPath,
      FAKE_CLAUDE_ARGS: argsPath,
    });
    await settingsStore.setAiPreferences("claude", "haiku");
    await settingsStore.acceptAiDisclosure("claude");

    await expect(runner.generate("request-claude", context)).resolves.toEqual({
      message: "fix: draft with claude",
      snapshotId: "a".repeat(64),
      patchTruncated: false,
      provider: "claude",
      model: "haiku",
    });
    expect(readFileSync(promptPath, "utf8")).toContain("safe staged line");
    expect(readFileSync(promptPath, "utf8")).toContain(
      "Do not encode another JSON object",
    );
    expect(JSON.parse(readFileSync(argsPath, "utf8"))).toEqual([
      "--safe-mode",
      "--print",
      "--model",
      "haiku",
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(__testing.COMMIT_MESSAGE_SCHEMA),
      "--max-turns",
      "1",
      "--no-session-persistence",
      "--tools",
      "",
      "--strict-mcp-config",
      "--permission-mode",
      "dontAsk",
    ]);
  });
});
