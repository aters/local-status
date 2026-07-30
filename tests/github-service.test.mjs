// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { GithubService } from "../electron/github-service.mjs";

describe("GitHub CLI account detection", () => {
  it("uses commands supported by older releases", async () => {
    const runFile = vi
      .fn()
      .mockResolvedValue({ stdout: "aters\n", stderr: "" });
    const service = new GithubService({ runFile });

    await expect(
      service.activeAccount("/opt/homebrew/bin/gh"),
    ).resolves.toBe("aters");
    expect(runFile).toHaveBeenCalledOnce();
    expect(runFile.mock.calls[0][1]).toEqual([
      "api",
      "user",
      "--jq",
      ".login",
    ]);
    expect(runFile.mock.calls[0][2].env.GH_HOST).toBe("github.com");
  });

  it("rejects an empty account response", async () => {
    const service = new GithubService({
      runFile: vi.fn().mockResolvedValue({ stdout: "\n", stderr: "" }),
    });

    await expect(
      service.activeAccount("/opt/homebrew/bin/gh"),
    ).rejects.toThrow(/GitHub CLI is not signed in/);
  });
});
