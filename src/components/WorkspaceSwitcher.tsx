import {
  Check,
  ChevronDown,
  Folder,
  FolderOpen,
  LoaderCircle,
  Plus,
} from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Workspace } from "../types";

export function WorkspaceSwitcher({
  current,
  recent,
  busy,
  error,
  onChoose,
  onOpenRecent,
  onClearError,
}: {
  current: Workspace;
  recent: Workspace[];
  busy: boolean;
  error: string | null;
  onChoose: () => Promise<boolean>;
  onOpenRecent: (path: string) => Promise<boolean>;
  onClearError: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const actionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const recentWorkspaces = useMemo(
    () =>
      recent.filter(
        (workspace, index, entries) =>
          workspace.path !== current.path &&
          entries.findIndex((entry) => entry.path === workspace.path) === index,
      ),
    [current.path, recent],
  );

  function enabledActions() {
    return actionRefs.current.filter(
      (button): button is HTMLButtonElement => Boolean(button && !button.disabled),
    );
  }

  const closeMenu = useCallback(
    (restoreFocus = false) => {
      setOpen(false);
      onClearError();
      if (restoreFocus) {
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    },
    [onClearError],
  );

  function openMenu() {
    onClearError();
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;

    const focusFrame = window.requestAnimationFrame(() => {
      enabledActions()[0]?.focus();
    });

    function dismissOnOutsideClick(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || containerRef.current?.contains(target)) return;
      closeMenu();
    }

    document.addEventListener("pointerdown", dismissOnOutsideClick, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", dismissOnOutsideClick, true);
    };
  }, [closeMenu, open]);

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }

    const actions = enabledActions();
    if (!actions.length) return;
    const currentIndex = actions.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;

    if (event.key === "ArrowDown") {
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % actions.length;
    } else if (event.key === "ArrowUp") {
      nextIndex =
        currentIndex < 0 ? actions.length - 1 : (currentIndex - 1 + actions.length) % actions.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = actions.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    actions[nextIndex]?.focus();
  }

  async function chooseWorkspace() {
    if (await onChoose()) closeMenu(true);
  }

  async function openRecent(path: string) {
    if (await onOpenRecent(path)) closeMenu(true);
  }

  function toggleMenu(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (open) closeMenu(true);
    else openMenu();
  }

  return (
    <div className="workspace-switcher-shell" ref={containerRef}>
      <button
        ref={triggerRef}
        className="workspace-switcher"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onPointerDown={toggleMenu}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            openMenu();
          } else if (open && event.key === "Escape") {
            event.preventDefault();
            closeMenu(true);
          }
        }}
        disabled={busy}
        title={current.path}
      >
        {busy ? (
          <LoaderCircle className="workspace-switcher__spinner" size={16} />
        ) : (
          <FolderOpen size={16} />
        )}
        <span className="workspace-switcher__name">{current.name}</span>
        <ChevronDown
          className={`workspace-switcher__chevron${open ? " is-open" : ""}`}
          size={14}
        />
      </button>

      {open && (
        <div
          id={menuId}
          className="workspace-menu"
          role="menu"
          aria-label="Switch workspace"
          aria-busy={busy}
          onKeyDown={handleMenuKeyDown}
        >
          <div className="workspace-menu__heading">Workspaces</div>
          <div
            className="workspace-menu__item workspace-menu__item--current"
            role="menuitem"
            aria-current="true"
            aria-disabled="true"
            title={current.path}
          >
            <FolderOpen size={16} />
            <span className="workspace-menu__copy">
              <strong>{current.name}</strong>
              <small>{current.path}</small>
            </span>
            <Check className="workspace-menu__check" size={16} />
          </div>

          {recentWorkspaces.length > 0 && (
            <>
              <div className="workspace-menu__label">Recent</div>
              <div className="workspace-menu__recent">
                {recentWorkspaces.map((workspace, index) => (
                  <button
                    key={workspace.path}
                    ref={(button) => {
                      actionRefs.current[index] = button;
                    }}
                    className="workspace-menu__item"
                    type="button"
                    role="menuitem"
                    title={workspace.path}
                    disabled={busy}
                    onClick={() => void openRecent(workspace.path)}
                  >
                    <Folder size={16} />
                    <span className="workspace-menu__copy">
                      <strong>{workspace.name}</strong>
                      <small>{workspace.path}</small>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {error && (
            <div className="workspace-menu__error" role="alert">
              {error}
            </div>
          )}

          <div className="workspace-menu__footer">
            <button
              ref={(button) => {
                actionRefs.current[recentWorkspaces.length] = button;
              }}
              className="workspace-menu__add"
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => void chooseWorkspace()}
            >
              {busy ? (
                <LoaderCircle className="workspace-switcher__spinner" size={16} />
              ) : (
                <Plus size={16} />
              )}
              Add workspace…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
