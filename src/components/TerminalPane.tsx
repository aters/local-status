import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Search, X } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { api } from "../api";
import type { TerminalEvent, TerminalSession } from "../types";

export interface TerminalPaneHandle {
  focus: () => void;
}

export const TerminalPane = forwardRef<
  TerminalPaneHandle,
  { session: TerminalSession; autoFocus?: boolean }
>(function TerminalPane({ session, autoFocus = false }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  function focusTerminal() {
    terminalRef.current?.focus();
  }

  useImperativeHandle(ref, () => ({ focus: focusTerminal }), []);

  useEffect(() => {
    if (!hostRef.current) return;
    const terminal = new Terminal({
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily:
        '"DM Mono", "SFMono-Regular", Menlo, Monaco, Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      scrollback: 10_000,
      theme: {
        background: "#08100e",
        foreground: "#d7e3dd",
        cursor: "#69e5a5",
        cursorAccent: "#08100e",
        selectionBackground: "#28533f",
        black: "#0b1210",
        red: "#f27b83",
        green: "#69e5a5",
        yellow: "#e2c276",
        blue: "#67a6d8",
        magenta: "#bb8ad7",
        cyan: "#4fd1c5",
        white: "#d7e3dd",
        brightBlack: "#587068",
        brightRed: "#ff9298",
        brightGreen: "#8af0ba",
        brightYellow: "#f2d58c",
        brightBlue: "#86bee7",
        brightMagenta: "#d1a2e9",
        brightCyan: "#7ce4da",
        brightWhite: "#f3f7f5",
      },
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    terminal.loadAddon(
      new WebLinksAddon((_event, uri) => {
        void api.openLocalUrl(uri).catch(() => undefined);
      }),
    );
    terminal.open(hostRef.current);
    terminalRef.current = terminal;
    searchAddonRef.current = search;
    if (session.truncated) {
      terminal.writeln("\x1b[38;5;214m[Earlier terminal output was truncated]\x1b[0m");
    }
    terminal.write(session.buffer);
    fit.fit();
    void api.resizeTerminal(session.id, terminal.cols, terminal.rows);
    if (autoFocus) {
      window.requestAnimationFrame(() => terminal.focus());
    }

    const dataDisposable = terminal.onData((data) => {
      void api.writeTerminal(session.id, data);
    });
    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
      void api.resizeTerminal(session.id, terminal.cols, terminal.rows);
    });
    resizeObserver.observe(hostRef.current);
    const onEvent = (event: TerminalEvent) => {
      if (event.type === "output" && event.sessionId === session.id) {
        terminal.write(event.data);
      }
    };
    window.localStatus.terminals.onEvent(onEvent);

    return () => {
      window.localStatus.terminals.offEvent(onEvent);
      resizeObserver.disconnect();
      dataDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      searchAddonRef.current = null;
    };
  }, [autoFocus, session.id, session.buffer, session.truncated]);

  function closeSearch() {
    setSearchOpen(false);
    window.requestAnimationFrame(focusTerminal);
  }

  return (
    <div className="terminal-pane">
      <div className={`terminal-search ${searchOpen ? "is-open" : ""}`}>
        {searchOpen ? (
          <>
            <Search size={14} />
            <input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                if (event.target.value) {
                  searchAddonRef.current?.findNext(event.target.value, {
                    incremental: true,
                  });
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && query) {
                  searchAddonRef.current?.findNext(query);
                }
                if (event.key === "Escape") closeSearch();
              }}
              placeholder="Search output"
              aria-label="Search terminal output"
            />
            <button type="button" onClick={closeSearch} aria-label="Close search">
              <X size={14} />
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setSearchOpen(true)}>
            <Search size={14} /> Search
          </button>
        )}
      </div>
      <div
        className="terminal-host"
        ref={hostRef}
        onMouseDown={() => window.requestAnimationFrame(focusTerminal)}
      />
    </div>
  );
});
