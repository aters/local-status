import { Archive, Check, FileCode2, X } from "lucide-react";
import {
  useEffect,
  useRef,
  type FormEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";

interface StashModalProps {
  repositoryId: string;
  path: string | null;
  message: string;
  includeUntracked: boolean;
  counts: {
    staged: number;
    unstaged: number;
    untracked: number;
  };
  error: string | null;
  creating: boolean;
  onMessageChange: (message: string) => void;
  onIncludeUntrackedChange: (include: boolean) => void;
  onClose: () => void;
  onCreate: () => void;
}

export function StashModal({
  repositoryId,
  path,
  message,
  includeUntracked,
  counts,
  error,
  creating,
  onMessageChange,
  onIncludeUntrackedChange,
  onClose,
  onCreate,
}: StashModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  const createRef = useRef(onCreate);

  useEffect(() => {
    closeRef.current = onClose;
    createRef.current = onCreate;
  }, [onClose, onCreate]);

  useEffect(() => {
    messageRef.current?.focus();
    function handleKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape" && !creating) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !creating) {
        event.preventDefault();
        createRef.current();
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
    }
    document.addEventListener("keydown", handleKeyboard);
    return () => document.removeEventListener("keydown", handleKeyboard);
  }, [creating]);

  function closeFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && !creating) onClose();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!creating) onCreate();
  }

  return createPortal(
    <div className="commit-modal-backdrop" onMouseDown={closeFromBackdrop}>
      <div
        ref={dialogRef}
        className="stash-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stash-modal-title"
        aria-describedby="stash-modal-description"
      >
        <header className="stash-modal__header">
          <span className="stash-modal__mark">
            <Archive size={20} />
          </span>
          <div>
            <span className="eyebrow">Save work for later</span>
            <h2 id="stash-modal-title">
              {path ? "Stash this file" : "Stash changes"}
            </h2>
            <p id="stash-modal-description">
              {path
                ? "The complete staged and unstaged state of this file will be saved."
                : "The working tree will be reset after Git saves these changes."}
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close stash window"
            disabled={creating}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <form className="stash-modal__body" onSubmit={submit}>
          <div className="stash-modal__repository">
            {path ? <FileCode2 size={15} /> : <Archive size={15} />}
            <span>
              <strong>{path ?? repositoryId}</strong>
              <small>{path ? repositoryId : "Current repository"}</small>
            </span>
          </div>

          {!path && (
            <div className="stash-modal__counts" aria-label="Changes to stash">
              <span>
                <strong>{counts.staged}</strong>
                Staged
              </span>
              <span>
                <strong>{counts.unstaged}</strong>
                Unstaged
              </span>
              <span>
                <strong>{counts.untracked}</strong>
                Untracked
              </span>
            </div>
          )}

          <label className="stash-modal__message">
            Message <span>Optional</span>
            <input
              ref={messageRef}
              value={message}
              maxLength={200}
              placeholder={path ? `Work on ${path.split("/").pop()}` : "What are you saving?"}
              disabled={creating}
              onChange={(event) => onMessageChange(event.target.value)}
            />
            <small>{message.length} / 200</small>
          </label>

          {!path && (
            <label className="stash-modal__checkbox">
              <input
                type="checkbox"
                checked={includeUntracked}
                disabled={creating}
                onChange={(event) =>
                  onIncludeUntrackedChange(event.target.checked)
                }
              />
              <span>
                <Check size={13} />
              </span>
              <strong>Include untracked files</strong>
              <small>Ignored files stay in place.</small>
            </label>
          )}

          {error && <div className="stash-modal__error">{error}</div>}

          <footer className="stash-modal__footer">
            <button
              className="secondary-button"
              type="button"
              disabled={creating}
              onClick={onClose}
            >
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={creating}>
              <Archive size={14} />
              {creating ? "Stashing…" : path ? "Stash file" : "Stash changes"}
            </button>
          </footer>
        </form>
      </div>
    </div>,
    document.body,
  );
}
