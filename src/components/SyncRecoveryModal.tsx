import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  GitCompareArrows,
  GitMerge,
  GitPullRequestArrow,
  LoaderCircle,
  LocateFixed,
  Settings2,
  Sparkles,
  SquareTerminal,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import type {
  AiProvider,
  AiStatus,
  SyncResult,
  SyncStrategy,
} from "../types";

type RecoveryResult = Extract<
  SyncResult,
  { outcome: "diverged" | "paused" }
>;

interface SyncRecoveryModalProps {
  result: RecoveryResult;
  strategy: SyncStrategy;
  busy: boolean;
  error: string | null;
  aiStatus: AiStatus | null;
  suspended: boolean;
  onStrategyChange: (strategy: SyncStrategy) => void;
  onResolve: () => void;
  onClose: () => void;
  onStash: () => void;
  onViewConflicts: () => void;
  onOpenTerminal: () => void;
  onStartAi: () => void;
  onProviderChange: (provider: AiProvider) => void;
  onModelChange: (model: string) => void;
  onInstallAi: () => void;
  onSignInAi: () => void;
  onLocateAi: () => void;
}

function operationLabel(operation: SyncStrategy) {
  return operation === "rebase" ? "Rebase" : "Merge";
}

export function SyncRecoveryModal({
  result,
  strategy,
  busy,
  error,
  aiStatus,
  suspended,
  onStrategyChange,
  onResolve,
  onClose,
  onStash,
  onViewConflicts,
  onOpenTerminal,
  onStartAi,
  onProviderChange,
  onModelChange,
  onInstallAi,
  onSignInAi,
  onLocateAi,
}: SyncRecoveryModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstStrategyRef = useRef<HTMLInputElement>(null);
  const pausedPrimaryRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const canClose = !busy && !suspended;
  const paused = result.outcome === "paused";
  const hasConflicts = paused && result.conflictFiles.length > 0;
  const providerStatus = aiStatus?.providers[aiStatus.provider] ?? null;
  const selectedModel = providerStatus?.models.find(
    (model) => model.id === aiStatus?.model,
  );

  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (result.outcome === "diverged") firstStrategyRef.current?.focus();
    else pausedPrimaryRef.current?.focus();
    return () => returnFocusRef.current?.focus();
  }, [result.outcome]);

  useEffect(() => {
    if (suspended) return;
    function handleKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape" && canClose) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
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
  }, [canClose, onClose, suspended]);

  function closeFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && canClose) onClose();
  }

  const continueCommand = paused
    ? `git ${result.operation} --continue`
    : "";
  const abortCommand = paused ? `git ${result.operation} --abort` : "";

  return createPortal(
    <div className="commit-modal-backdrop" onMouseDown={closeFromBackdrop}>
      <div
        ref={dialogRef}
        className={`sync-recovery-modal ${suspended ? "is-suspended" : ""}`}
        role="dialog"
        aria-modal={!suspended}
        aria-hidden={suspended || undefined}
        aria-labelledby="sync-recovery-title"
        aria-describedby="sync-recovery-description"
      >
        <header className="sync-recovery-modal__header">
          <span className="sync-recovery-modal__mark">
            {paused ? <GitMerge size={20} /> : <GitCompareArrows size={20} />}
          </span>
          <div>
            <span className="eyebrow">
              {paused ? `${operationLabel(result.operation)} paused` : "Sync recovery"}
            </span>
            <h2 id="sync-recovery-title">
              {paused
                ? hasConflicts
                  ? "Resolve conflicts to continue"
                  : "Ready to continue"
                : "Local and remote histories diverged"}
            </h2>
            <p id="sync-recovery-description">
              {paused
                ? hasConflicts
                  ? `Git paused the ${result.operation} before changing the remote branch.`
                  : `All conflicts are staged. Continue or abort the ${result.operation} in a terminal.`
                : "Choose how to integrate the incoming commits. Nothing changes until you confirm."}
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close sync recovery"
            disabled={!canClose}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <div className="sync-recovery-modal__body">
          <div className="sync-recovery-modal__repository">
            <GitPullRequestArrow size={15} />
            <span>
              <strong>{result.branch || "Current branch"}</strong>
              <small>{result.upstream || "Configured upstream"}</small>
            </span>
            <span className="sync-recovery-modal__signals">
              <span className="is-incoming">
                <ArrowDown size={12} />
                {result.incoming} incoming
              </span>
              <span className="is-outgoing">
                <ArrowUp size={12} />
                {result.outgoing} outgoing
              </span>
            </span>
          </div>

          {result.outcome === "diverged" ? (
            <>
              <fieldset
                className="sync-recovery-modal__strategies"
                disabled={busy}
              >
                <legend>Integration strategy</legend>
                <label className={strategy === "rebase" ? "is-selected" : ""}>
                  <input
                    ref={firstStrategyRef}
                    type="radio"
                    name="sync-strategy"
                    value="rebase"
                    checked={strategy === "rebase"}
                    onChange={() => onStrategyChange("rebase")}
                  />
                  <span className="sync-recovery-modal__strategy-icon">
                    <GitPullRequestArrow size={17} />
                  </span>
                  <span>
                    <strong>
                      Rebase <small>Recommended</small>
                    </strong>
                    <span>Replay local commits on top of the upstream branch.</span>
                    <code>Linear history · local commit IDs change</code>
                  </span>
                  {strategy === "rebase" && <Check size={15} />}
                </label>
                <label className={strategy === "merge" ? "is-selected" : ""}>
                  <input
                    type="radio"
                    name="sync-strategy"
                    value="merge"
                    checked={strategy === "merge"}
                    onChange={() => onStrategyChange("merge")}
                  />
                  <span className="sync-recovery-modal__strategy-icon">
                    <GitMerge size={17} />
                  </span>
                  <span>
                    <strong>Merge</strong>
                    <span>Combine both histories with a merge commit.</span>
                    <code>Preserves existing local commit IDs</code>
                  </span>
                  {strategy === "merge" && <Check size={15} />}
                </label>
              </fieldset>

              {result.workingTreeDirty && (
                <div className="sync-recovery-modal__blocked" role="status">
                  <AlertTriangle size={16} />
                  <span>
                    <strong>Working changes need a safe place first</strong>
                    <small>Commit, revert, or stash them before rewriting or merging history.</small>
                  </span>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={onStash}
                  >
                    Stash changes
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              {hasConflicts && (
                <section className="sync-recovery-modal__conflicts">
                  <div>
                    <span>
                      <AlertTriangle size={15} />
                      <strong>
                        {result.conflictFiles.length} conflicted{" "}
                        {result.conflictFiles.length === 1 ? "file" : "files"}
                      </strong>
                    </span>
                    <button
                      ref={pausedPrimaryRef}
                      className="secondary-button"
                      type="button"
                      onClick={onViewConflicts}
                    >
                      View conflicts
                    </button>
                  </div>
                  <ul>
                    {result.conflictFiles.slice(0, 5).map((path) => (
                      <li key={path}><code>{path}</code></li>
                    ))}
                    {result.conflictFiles.length > 5 && (
                      <li>+{result.conflictFiles.length - 5} more</li>
                    )}
                  </ul>
                </section>
              )}

              <section className="sync-recovery-modal__commands">
                <div>
                  <span>Continue after staging resolutions</span>
                  <code>{continueCommand}</code>
                </div>
                <div>
                  <span>Return to the pre-{result.operation} state</span>
                  <code>{abortCommand}</code>
                </div>
                <button
                  ref={hasConflicts ? undefined : pausedPrimaryRef}
                  className={hasConflicts ? "secondary-button" : "primary-button"}
                  type="button"
                  onClick={onOpenTerminal}
                >
                  <SquareTerminal size={14} />
                  {hasConflicts ? "Open terminal" : "Open terminal to continue"}
                </button>
              </section>

              {hasConflicts && (
                <section className="sync-recovery-modal__ai">
                  <div className="sync-recovery-modal__ai-title">
                    <span>
                      <Sparkles size={15} />
                      AI conflict assist
                    </span>
                    {providerStatus?.authenticated && (
                      <small><Check size={11} /> Ready</small>
                    )}
                  </div>
                  <p>
                    The interactive agent can edit and stage conflict resolutions,
                    but it will not continue, abort, commit, or push.
                  </p>
                  {aiStatus === null ? (
                    <span className="sync-recovery-modal__checking">
                      <LoaderCircle className="is-spinning" size={13} />
                      Checking AI providers…
                    </span>
                  ) : (
                    <>
                      <div className="sync-recovery-modal__ai-pickers">
                        <label>
                          Provider
                          <select
                            value={aiStatus.provider}
                            disabled={busy}
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
                            disabled={busy}
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
                      <div className="sync-recovery-modal__ai-action">
                        <span>
                          <Settings2 size={13} />
                          {selectedModel?.description || providerStatus?.error}
                        </span>
                        {!providerStatus?.available ? (
                          <div>
                            {aiStatus.provider === "claude" && (
                              <button
                                className="secondary-button"
                                type="button"
                                onClick={onInstallAi}
                              >
                                Install Claude
                              </button>
                            )}
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={onLocateAi}
                            >
                              <LocateFixed size={12} />
                              Locate existing
                            </button>
                          </div>
                        ) : !providerStatus.authenticated ? (
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={onSignInAi}
                          >
                            <SquareTerminal size={13} />
                            Sign in to {providerStatus.label}
                          </button>
                        ) : (
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={onStartAi}
                          >
                            <Sparkles size={13} />
                            Resolve and stage with {providerStatus.label}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </section>
              )}
            </>
          )}

          {error && (
            <div className="sync-recovery-modal__error" role="alert">
              <AlertTriangle size={15} />
              {error}
            </div>
          )}
        </div>

        {result.outcome === "diverged" && (
          <footer className="sync-recovery-modal__footer">
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
              disabled={busy || result.workingTreeDirty}
              onClick={onResolve}
            >
              {busy && <LoaderCircle className="is-spinning" size={14} />}
              {busy
                ? `${operationLabel(strategy)} in progress…`
                : `${operationLabel(strategy)} and sync`}
            </button>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
