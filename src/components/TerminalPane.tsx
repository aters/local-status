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
import { TERMINAL_THEMES } from "../terminal-themes";
import type { TerminalEvent, TerminalSession, Theme } from "../types";

export interface TerminalPaneHandle {
  focus: () => void;
}

export const TerminalPane = forwardRef<
  TerminalPaneHandle,
  {
    session: TerminalSession;
    autoFocus?: boolean;
    theme?: Theme;
    findRequest?: number;
  }
>(function TerminalPane(
  { session, autoFocus = false, theme = "green", findRequest = 0 },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
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
      fontSize: 14,
      lineHeight: 1.25,
      scrollback: 10_000,
      theme: TERMINAL_THEMES[theme],
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
  }, [autoFocus, session.id, session.buffer, session.truncated, theme]);

  useEffect(() => {
    if (!findRequest) return;
    setSearchOpen(true);
  }, [findRequest]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

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
              ref={searchInputRef}
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
                  if (event.shiftKey) searchAddonRef.current?.findPrevious(query);
                  else searchAddonRef.current?.findNext(query);
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
