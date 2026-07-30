import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const tooltipTargets = [
  "[data-tooltip]",
  "button[aria-label]",
  "button.icon-button",
  "button.change-action",
  "button.toolbar-button",
  ".profile-list button",
  ".terminal-search button",
].join(",");

interface TooltipState {
  label: string;
  anchor: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
}

interface TooltipPosition {
  left: number;
  top: number;
}

export function AppTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!tooltip || !tooltipRef.current) return;
    const margin = 8;
    const gap = 8;
    const bounds = tooltipRef.current.getBoundingClientRect();
    const centered =
      (tooltip.anchor.left + tooltip.anchor.right - bounds.width) / 2;
    const left = Math.min(
      Math.max(margin, centered),
      Math.max(margin, window.innerWidth - bounds.width - margin),
    );
    const below = tooltip.anchor.bottom + gap;
    const top =
      below + bounds.height <= window.innerHeight - margin
        ? below
        : Math.max(margin, tooltip.anchor.top - bounds.height - gap);
    setPosition({ left, top });
  }, [tooltip]);

  useEffect(() => {
    function show(event: Event) {
      const origin = event.target;
      if (!(origin instanceof Element)) return;
      const target = origin.closest<HTMLElement>(tooltipTargets);
      if (!target) return;
      const label =
        target.dataset.tooltip ||
        target.getAttribute("aria-label") ||
        target.getAttribute("title");
      if (!label) return;
      if (target.title) {
        target.dataset.tooltip ||= target.title;
        target.removeAttribute("title");
      }
      const rect = target.getBoundingClientRect();
      setPosition(null);
      setTooltip({
        label,
        anchor: {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        },
      });
    }

    function hide(event: Event) {
      const related = "relatedTarget" in event ? event.relatedTarget : null;
      if (
        related instanceof Node &&
        event.target instanceof Node &&
        event.target.parentElement?.contains(related)
      ) {
        return;
      }
      setTooltip(null);
    }

    document.addEventListener("pointerover", show);
    document.addEventListener("focusin", show);
    document.addEventListener("pointerout", hide);
    document.addEventListener("focusout", hide);
    return () => {
      document.removeEventListener("pointerover", show);
      document.removeEventListener("focusin", show);
      document.removeEventListener("pointerout", hide);
      document.removeEventListener("focusout", hide);
    };
  }, []);

  if (!tooltip) return null;
  return createPortal(
    <div
      ref={tooltipRef}
      className="app-tooltip"
      role="tooltip"
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
    >
      {tooltip.label}
    </div>,
    document.body,
  );
}
