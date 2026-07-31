import { randomUUID } from "node:crypto";

export const MAX_TERMINAL_BUFFER_BYTES = 2 * 1024 * 1024;

function publicSession(record) {
  return {
    id: record.id,
    repositoryId: record.repositoryId,
    title: record.title,
    kind: record.kind,
    status: record.status,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    exitCode: record.exitCode,
    signal: record.signal,
    truncated: record.truncated,
    buffer: record.buffer,
  };
}

function appendBounded(record, data) {
  record.buffer += data;
  const size = Buffer.byteLength(record.buffer, "utf8");
  if (size <= MAX_TERMINAL_BUFFER_BYTES) return;
  const excess = size - MAX_TERMINAL_BUFFER_BYTES;
  record.buffer = record.buffer.slice(Math.min(excess, record.buffer.length));
  record.truncated = true;
}

function terminalStartError(spec, error) {
  const message = error instanceof Error ? error.message : "Unknown error";
  if (/posix_spawnp failed/i.test(message)) {
    return `Local Status could not launch “${spec.executable}”. Verify that it exists and is available in the app's PATH.`;
  }
  return `Local Status could not start this terminal: ${message}`;
}

export class TerminalManager {
  constructor({ spawnPty, emit = () => undefined }) {
    this.spawnPty = spawnPty;
    this.emit = emit;
    this.sessions = new Map();
  }

  list() {
    return [...this.sessions.values()]
      .map(publicSession)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  hasRunningSessions() {
    return [...this.sessions.values()].some((session) =>
      ["running", "stopping"].includes(session.status),
    );
  }

  create(spec) {
    const record = {
      id: randomUUID(),
      repositoryId: spec.repositoryId,
      title: spec.title,
      kind: spec.kind,
      status: "running",
      startedAt: new Date().toISOString(),
      endedAt: null,
      exitCode: null,
      signal: null,
      truncated: false,
      buffer: "",
      spec: { ...spec },
      process: null,
      forceTimer: null,
      closed: false,
    };
    this.sessions.set(record.id, record);
    this.startProcess(record);
    this.emit({ type: "created", session: publicSession(record) });
    return publicSession(record);
  }

  startProcess(record) {
    try {
      const terminal = this.spawnPty(record.spec.executable, record.spec.args, {
        name: "xterm-256color",
        cols: 100,
        rows: 30,
        cwd: record.spec.cwd,
        env: { ...process.env, TERM: "xterm-256color" },
      });
      record.process = terminal;
      terminal.onData((data) => {
        if (record.closed) return;
        appendBounded(record, data);
        this.emit({
          type: "output",
          sessionId: record.id,
          data,
          truncated: record.truncated,
        });
      });
      terminal.onExit(({ exitCode, signal }) => {
        if (record.closed) return;
        if (record.forceTimer) clearTimeout(record.forceTimer);
        record.forceTimer = null;
        record.status = exitCode === 0 ? "exited" : "failed";
        record.exitCode = exitCode;
        record.signal = signal;
        record.endedAt = new Date().toISOString();
        record.process = null;
        this.emit({ type: "updated", session: publicSession(record) });
      });
    } catch (error) {
      record.status = "failed";
      record.endedAt = new Date().toISOString();
      appendBounded(
        record,
        `\r\n${terminalStartError(record.spec, error)}\r\n`,
      );
      this.emit({ type: "updated", session: publicSession(record) });
    }
  }

  requireSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Terminal session not found.");
    return session;
  }

  write(sessionId, data) {
    if (typeof data !== "string" || Buffer.byteLength(data, "utf8") > 64 * 1024) {
      throw new Error("Terminal input is invalid.");
    }
    const session = this.requireSession(sessionId);
    if (session.status !== "running" || !session.process) return;
    session.process.write(data);
  }

  resize(sessionId, cols, rows) {
    const session = this.requireSession(sessionId);
    if (!session.process || session.status !== "running") return;
    const safeCols = Math.min(Math.max(Math.floor(cols), 20), 500);
    const safeRows = Math.min(Math.max(Math.floor(rows), 5), 200);
    session.process.resize(safeCols, safeRows);
  }

  stop(sessionId) {
    const session = this.requireSession(sessionId);
    if (!session.process || !["running", "stopping"].includes(session.status)) return;
    session.status = "stopping";
    this.emit({ type: "updated", session: publicSession(session) });
    session.process.kill("SIGTERM");
    session.forceTimer = setTimeout(() => {
      if (session.process) session.process.kill("SIGKILL");
    }, 3_000);
    session.forceTimer.unref?.();
  }

  restart(sessionId) {
    const previous = this.requireSession(sessionId);
    if (previous.process) {
      throw new Error("Stop the terminal before restarting it.");
    }
    return this.create({ ...previous.spec, title: previous.title });
  }

  rename(sessionId, title) {
    if (typeof title !== "string" || !title.trim() || title.trim().length > 80) {
      throw new Error("Terminal name must be between 1 and 80 characters.");
    }
    const session = this.requireSession(sessionId);
    session.title = title.trim();
    this.emit({ type: "updated", session: publicSession(session) });
    return publicSession(session);
  }

  close(sessionId) {
    const session = this.requireSession(sessionId);
    session.closed = true;
    if (session.forceTimer) clearTimeout(session.forceTimer);
    if (session.process) {
      try {
        session.process.kill("SIGTERM");
      } catch {
        // The process may already have exited.
      }
    }
    this.sessions.delete(sessionId);
    this.emit({ type: "removed", sessionId });
  }

  async stopAll() {
    for (const session of this.sessions.values()) {
      if (session.process) {
        try {
          session.process.kill("SIGTERM");
        } catch {
          // The process may already have exited.
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    for (const session of this.sessions.values()) {
      if (session.process) {
        try {
          session.process.kill("SIGKILL");
        } catch {
          // The process may already have exited.
        }
      }
    }
  }
}

export const __testing = { appendBounded, publicSession, terminalStartError };
