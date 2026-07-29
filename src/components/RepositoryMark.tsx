import type { CSSProperties } from "react";
import {
  repositoryHealth,
  repositoryMarkVisual,
  type RepositoryHealth,
} from "../repository-mark";
import type { RepositorySummary } from "../types";

const healthLabels: Record<RepositoryHealth, string> = {
  clean: "Clean working tree",
  changed: "Uncommitted changes",
  conflict: "Merge conflicts",
  error: "Repository scan error",
};

function RepositoryGlyph({ symbol }: { symbol: number }) {
  switch (symbol) {
    case 0:
      return (
        <>
          <circle cx="9" cy="9" r="5.5" />
          <circle cx="9" cy="9" r="2" />
        </>
      );
    case 1:
      return (
        <>
          <path d="M9 2.5 15.5 9 9 15.5 2.5 9 9 2.5Z" />
          <circle className="is-filled" cx="9" cy="9" r="1.1" />
        </>
      );
    case 2:
      return <path d="M4 5h10M2.8 9h12.4M5 13h8" />;
    case 3:
      return (
        <>
          <rect x="3" y="3" width="8" height="8" rx="2" />
          <rect x="7" y="7" width="8" height="8" rx="2" />
        </>
      );
    case 4:
      return (
        <path d="M2.5 6.2c2.2-2 4.3-2 6.5 0s4.3 2 6.5 0M2.5 11.8c2.2-2 4.3-2 6.5 0s4.3 2 6.5 0" />
      );
    case 5:
      return (
        <path d="M9 2.5c.7 3.5 2 4.8 5.5 5.5-3.5.7-4.8 2-5.5 5.5-.7-3.5-2-4.8-5.5-5.5C7 7.3 8.3 6 9 2.5Z" />
      );
    case 6:
      return (
        <>
          <path d="m9 2.3 5.8 3.35v6.7L9 15.7l-5.8-3.35v-6.7L9 2.3Z" />
          <circle className="is-filled" cx="9" cy="9" r="1.2" />
        </>
      );
    default:
      return (
        <>
          <ellipse cx="9" cy="9" rx="6.4" ry="3.2" transform="rotate(-32 9 9)" />
          <circle className="is-filled" cx="13.6" cy="6" r="1.15" />
        </>
      );
  }
}

export function RepositoryMark({
  repository,
  size = "list",
}: {
  repository: RepositorySummary;
  size?: "list" | "header";
}) {
  const visual = repositoryMarkVisual(repository.id);
  const health = repositoryHealth(repository);
  const style = {
    "--repo-mark-background": visual.background,
    "--repo-mark-foreground": visual.foreground,
  } as CSSProperties;

  return (
    <span
      className={`repository-mark repository-mark--${size} repository-mark--${health}`}
      style={style}
      role="img"
      aria-label={healthLabels[health]}
      title={healthLabels[health]}
    >
      <svg
        viewBox="0 0 18 18"
        aria-hidden="true"
        focusable="false"
        data-symbol={visual.symbol}
      >
        <RepositoryGlyph symbol={visual.symbol} />
      </svg>
    </span>
  );
}
