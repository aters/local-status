// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  MAX_TERMINAL_BUFFER_BYTES,
  TerminalManager,
} from "../electron/terminal-manager.mjs";

class FakePty {
  dataHandler = () => undefined;
  exitHandler = () => undefined;
  writes = [];
  resizes = [];
  kills = [];

  onData(handler) {
    this.dataHandler = handler;
  }

  onExit(handler) {
    this.exitHandler = handler;
  }

  write(data) {
    this.writes.push(data);
  }

  resize(cols, rows) {
    this.resizes.push([cols, rows]);
  }

  kill(signal) {
    this.kills.push(signal);
  }
}

function spec() {
  return {
    repositoryId: "frontend",
    title: "Frontend",
    kind: "script",
    executable: "npm",
    args: ["run", "dev"],
    cwd: "/tmp/frontend",
  };
}

describe("TerminalManager", () => {
  it("streams input/output, resizes, stops, exits, and restarts a PTY", () => {
    const processes = [];
    const events = [];
    const manager = new TerminalManager({
      spawnPty: vi.fn(() => {
        const process = new FakePty();
        processes.push(process);
        return process;
      }),
      emit: (event) => events.push(event),
    });
    const session = manager.create(spec());
    processes[0].dataHandler("server ready\r\n");
    manager.write(session.id, "r");
    manager.resize(session.id, 140, 45);
    manager.stop(session.id);
    processes[0].exitHandler({ exitCode: 0, signal: 15 });

    expect(manager.list()[0]).toMatchObject({
      status: "exited",
      buffer: "server ready\r\n",
      exitCode: 0,
    });
    expect(processes[0].writes).toEqual(["r"]);
    expect(processes[0].resizes).toEqual([[140, 45]]);
    expect(processes[0].kills).toContain("SIGTERM");
    const restarted = manager.restart(session.id);
    expect(restarted.id).not.toBe(session.id);
    expect(processes).toHaveLength(2);
    expect(events.some((event) => event.type === "output")).toBe(true);
  });

  it("caps terminal output and ignores events after a session is closed", () => {
    const process = new FakePty();
    const events = [];
    const manager = new TerminalManager({
      spawnPty: () => process,
      emit: (event) => events.push(event),
    });
    const session = manager.create(spec());
    process.dataHandler("x".repeat(MAX_TERMINAL_BUFFER_BYTES + 10_000));

    expect(Buffer.byteLength(manager.list()[0].buffer)).toBeLessThanOrEqual(
      MAX_TERMINAL_BUFFER_BYTES,
    );
    expect(manager.list()[0].truncated).toBe(true);
    manager.close(session.id);
    const eventCount = events.length;
    process.dataHandler("ignored");
    process.exitHandler({ exitCode: 1, signal: 15 });
    expect(events).toHaveLength(eventCount);
    expect(manager.list()).toEqual([]);
  });
});
