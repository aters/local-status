import { CircleStop, LoaderCircle, SquareTerminal, X } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import type {
  AiProvider,
  AiTerminalAction,
  TerminalEvent,
  TerminalSession,
  Theme,
} from "../types";
import { TerminalPane } from "./TerminalPane";

interface AiTerminalModalProps {
  session: TerminalSession;
  provider: AiProvider;
  action: AiTerminalAction;
  theme: Theme;
  onClose: () => void;
}

export function AiTerminalModal({
  session,
  provider,
  action,
  theme,
  onClose,
}: AiTerminalModalProps) {
  const [currentSession, setCurrentSession] = useState(session);
  const [stopping, setStopping] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const providerLabel = provider === "codex" ? "Codex" : "Claude";
  const title =
    action === "install"
      ? `Install ${providerLabel} CLI`
      : `Sign in to ${providerLabel}`;
  const running = ["running", "stopping"].includes(currentSession.status);

  useEffect(() => {
    setCurrentSession(session);
  }, [session]);

  useEffect(() => {
    const onEvent = (event: TerminalEvent) => {
      if (
        (event.type === "created" || event.type === "updated") &&
        event.session.id === session.id
      ) {
        setCurrentSession(event.session);
        if (event.session.status !== "stopping") setStopping(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.localStatus.terminals.onEvent(onEvent);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.localStatus.terminals.offEvent(onEvent);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, session.id]);

  function closeFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  async function stopTerminal() {
    setStopping(true);
    try {
      await api.stopTerminal(session.id);
    } finally {
      setStopping(false);
    }
  }

  return createPortal(
    <div
      className="ai-terminal-modal-backdrop"
      onMouseDown={closeFromBackdrop}
    >
      <section
        ref={dialogRef}
        className="ai-terminal-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-terminal-title"
        aria-describedby="ai-terminal-description"
      >
        <header className="ai-terminal-modal__header">
          <span>
            <SquareTerminal size={18} />
          </span>
          <div>
            <p className="eyebrow">
              {action === "install" ? "Provider setup" : "Provider sign-in"}
            </p>
            <h2 id="ai-terminal-title">{title}</h2>
            <p id="ai-terminal-description">
              {action === "install"
                ? "Follow the installer and account prompts below."
                : "Complete the interactive account prompts below."}
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close setup terminal"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <div
          className="ai-terminal-modal__terminal"
          onKeyDown={(event) => event.stopPropagation()}
        >
          <TerminalPane session={currentSession} autoFocus theme={theme} />
        </div>

        <footer className="ai-terminal-modal__footer">
          <span>
            <i className={`session-status is-${currentSession.status}`} />
            {running
              ? "The terminal keeps running if you close this window."
              : "Setup terminal finished. Close to re-check the provider."}
          </span>
          <div>
            {running && (
              <button
                className="secondary-button"
                type="button"
                disabled={stopping}
                onClick={() => void stopTerminal()}
              >
                {stopping ? (
                  <LoaderCircle className="is-spinning" size={13} />
                ) : (
                  <CircleStop size={13} />
                )}
                Stop
              </button>
            )}
            <button className="primary-button" type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
