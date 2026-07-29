import {
  AlertTriangle,
  Check,
  GitBranch,
  GitCommitHorizontal,
  ChevronDown,
  LoaderCircle,
  LocateFixed,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import type { AiProvider, AiStatus, CommitContext } from "../types";

interface CommitModalProps {
  context: CommitContext | null;
  message: string;
  error: string | null;
  aiStatus: AiStatus | null;
  preparing: boolean;
  committing: boolean;
  generating: boolean;
  onMessageChange: (message: string) => void;
  onClose: () => void;
  onCommit: () => void;
  onGenerate: () => void;
  onCancelGeneration: () => void;
  onProviderChange: (provider: AiProvider) => void;
  onModelChange: (model: string) => void;
  onLocateAi: () => void;
}

function branchLabel(context: CommitContext | null) {
  if (!context) return "Preparing commit";
  if (context.detached) return "Detached HEAD";
  if (context.unborn) return `${context.branch || "New branch"} · initial commit`;
  return context.branch || "Current branch";
}

export function CommitModal({
  context,
  message,
  error,
  aiStatus,
  preparing,
  committing,
  generating,
  onMessageChange,
  onClose,
  onCommit,
  onGenerate,
  onCancelGeneration,
  onProviderChange,
  onModelChange,
  onLocateAi,
}: CommitModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const aiSettingsRef = useRef<HTMLDivElement>(null);
  const aiSettingsButtonRef = useRef<HTMLButtonElement>(null);
  const providerSelectRef = useRef<HTMLSelectElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  const commitRef = useRef(onCommit);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const canClose = !committing && !generating;
  const canCommit = Boolean(context && message.trim() && !preparing && canClose);
  const providerStatus = aiStatus?.providers[aiStatus.provider] ?? null;
  const providerLabel = providerStatus?.label ?? "AI";
  const selectedModel = providerStatus?.models.find(
    (model) => model.id === aiStatus?.model,
  );

  useEffect(() => {
    closeRef.current = onClose;
    commitRef.current = onCommit;
  }, [onClose, onCommit]);

  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    return () => returnFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!preparing) messageRef.current?.focus();
  }, [preparing]);

  useEffect(() => {
    if (!aiSettingsOpen) return;
    providerSelectRef.current?.focus();
    function closeFromOutside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !aiSettingsRef.current?.contains(event.target)
      ) {
        setAiSettingsOpen(false);
      }
    }
    document.addEventListener("pointerdown", closeFromOutside);
    return () => document.removeEventListener("pointerdown", closeFromOutside);
  }, [aiSettingsOpen]);

  useEffect(() => {
    messageRef.current?.focus();

    function handleKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape" && aiSettingsOpen) {
        event.preventDefault();
        setAiSettingsOpen(false);
        aiSettingsButtonRef.current?.focus();
        return;
      }
      if (event.key === "Escape" && canClose) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canCommit) {
        event.preventDefault();
        commitRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
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
    }

    document.addEventListener("keydown", handleKeyboard);
    return () => document.removeEventListener("keydown", handleKeyboard);
  }, [aiSettingsOpen, canClose, canCommit]);

  function closeFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && canClose) onClose();
  }

  function submitFromTextarea(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter" || !canCommit) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onCommit();
  }

  return createPortal(
    <div className="commit-modal-backdrop" onMouseDown={closeFromBackdrop}>
      <div
        ref={dialogRef}
        className="commit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="commit-modal-title"
        aria-describedby="commit-modal-description"
      >
        <header className="commit-modal__header">
          <span className="commit-modal__mark">
            <GitCommitHorizontal size={20} />
          </span>
          <div>
            <span className="eyebrow">Create commit</span>
            <h2 id="commit-modal-title">Commit staged changes</h2>
            <p id="commit-modal-description">
              Only files already in the Git index will be committed.
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close commit window"
            disabled={!canClose}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <div className="commit-modal__body">
          <section className="commit-modal__context">
            <div className="commit-modal__branch">
              <GitBranch size={14} />
              <span>{branchLabel(context)}</span>
              {context && (
                <strong>
                  {context.stagedFiles.length} staged{" "}
                  {context.stagedFiles.length === 1 ? "file" : "files"}
                </strong>
              )}
            </div>
            {preparing ? (
              <div className="commit-modal__files is-loading">
                <span />
                <span />
                <span />
              </div>
            ) : (
              <div className="commit-modal__files" aria-label="Staged files">
                {context?.stagedFiles.map((file) => (
                  <div key={`${file.status}:${file.previousPath}:${file.path}`}>
                    <span className={`change-kind change-kind--${file.kind}`}>
                      {file.status}
                    </span>
                    <code title={file.path}>
                      {file.previousPath
                        ? `${file.previousPath} → ${file.path}`
                        : file.path}
                    </code>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="commit-modal__composer">
            <label htmlFor="commit-message">Commit message</label>
            <textarea
              ref={messageRef}
              id="commit-message"
              value={message}
              maxLength={20_000}
              placeholder="Summarize the staged changes"
              disabled={preparing || committing}
              onChange={(event) => onMessageChange(event.target.value)}
              onKeyDown={submitFromTextarea}
            />
            <div className="commit-modal__message-meta">
              <span>Subject line first; add a body when useful.</span>
              <span>{message.length.toLocaleString()} / 20,000</span>
            </div>
          </section>

          <section className="commit-modal__codex">
            <div className="commit-modal__codex-title">
              <span>
                <Sparkles size={15} />
                Draft with AI
              </span>
              <div
                ref={aiSettingsRef}
                className="commit-modal__ai-settings"
              >
                {providerStatus?.authenticated && (
                  <small>
                    <Check size={11} />
                    Ready
                  </small>
                )}
                <button
                  ref={aiSettingsButtonRef}
                  className="commit-modal__ai-settings-button"
                  type="button"
                  title={
                    aiStatus
                      ? `${providerLabel} CLI · ${selectedModel?.label ?? aiStatus.model}`
                      : "AI draft settings"
                  }
                  aria-label="AI draft settings"
                  aria-haspopup="dialog"
                  aria-expanded={aiSettingsOpen}
                  aria-controls="commit-ai-settings"
                  disabled={!aiStatus || generating || committing}
                  onClick={() => setAiSettingsOpen((open) => !open)}
                >
                  <Settings2 size={14} />
                  <ChevronDown
                    className={aiSettingsOpen ? "is-open" : ""}
                    size={11}
                  />
                </button>
                {aiStatus && aiSettingsOpen && (
                  <div
                    className="commit-modal__ai-popover"
                    id="commit-ai-settings"
                    role="dialog"
                    aria-label="AI draft settings"
                  >
                    <div className="commit-modal__ai-popover-header">
                      <strong>AI draft settings</strong>
                      <span>
                        {providerLabel} · {selectedModel?.label ?? aiStatus.model}
                      </span>
                    </div>
                    <div className="commit-modal__ai-picker">
                      <label>
                        Provider
                        <select
                          ref={providerSelectRef}
                          value={aiStatus.provider}
                          disabled={generating || committing}
                          onChange={(event) =>
                            onProviderChange(event.target.value as AiProvider)
                          }
                        >
                          <option value="codex">Codex CLI</option>
                          <option value="claude">Claude CLI</option>
                        </select>
                      </label>
                      <label>
                        Model
                        <select
                          value={aiStatus.model}
                          disabled={generating || committing}
                          onChange={(event) => onModelChange(event.target.value)}
                        >
                          {providerStatus?.models.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {selectedModel && (
                      <small className="commit-modal__ai-model-description">
                        {selectedModel.description}
                      </small>
                    )}
                  </div>
                )}
              </div>
            </div>
            <p>
              {providerLabel} receives the staged diff, file names, statistics,
              and recent commit subjects. It never commits automatically.
            </p>
            <div className="commit-modal__codex-actions">
              {aiStatus === null ? (
                <span className="commit-modal__codex-checking">
                  <LoaderCircle className="is-spinning" size={13} />
                  Checking AI providers…
                </span>
              ) : !providerStatus?.available ? (
                <>
                  <span>{providerLabel} CLI was not found.</span>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={generating || committing}
                    onClick={onLocateAi}
                  >
                    <LocateFixed size={13} />
                    Locate {providerLabel} CLI
                  </button>
                </>
              ) : !providerStatus.authenticated ? (
                <span>
                  Sign in from a terminal with{" "}
                  <code>
                    {aiStatus.provider === "codex"
                      ? "codex login"
                      : "claude auth login"}
                  </code>
                  .
                </span>
              ) : generating ? (
                <>
                  <span className="commit-modal__codex-checking">
                    <LoaderCircle className="is-spinning" size={13} />
                    Generating a draft…
                  </span>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={onCancelGeneration}
                  >
                    Cancel generation
                  </button>
                </>
              ) : (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!context || preparing || committing}
                  onClick={onGenerate}
                >
                  <Sparkles size={13} />
                  Generate with {providerLabel}
                </button>
              )}
            </div>
          </section>

          {error && (
            <div className="commit-modal__error" role="alert">
              <AlertTriangle size={15} />
              <span>{error}</span>
            </div>
          )}
        </div>

        <footer className="commit-modal__footer">
          <span>
            <kbd>⌘</kbd>
            <kbd>Enter</kbd>
            to commit
          </span>
          <div>
            <button
              className="secondary-button"
              type="button"
              disabled={!canClose}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={!canCommit}
              onClick={onCommit}
            >
              {committing ? (
                <LoaderCircle className="is-spinning" size={14} />
              ) : (
                <GitCommitHorizontal size={14} />
              )}
              {committing ? "Committing…" : "Commit"}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
