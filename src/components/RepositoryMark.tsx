import type { CSSProperties } from "react";
import {
  repositoryHealth,
  repositoryMarkVisual,
  type RepositoryHealth,
  type RepositoryMarkVisual,
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
    case 7:
      return (
        <>
          <ellipse cx="9" cy="9" rx="6.4" ry="3.2" transform="rotate(-32 9 9)" />
          <circle className="is-filled" cx="13.6" cy="6" r="1.15" />
        </>
      );
    case 8:
      return (
        <>
          <path d="m9 2.5 6 11H3l6-11Z" />
          <circle className="is-filled" cx="9" cy="9.6" r="1.15" />
        </>
      );
    case 9:
      return <path d="M6.2 3.2H3.5v11.6h2.7M11.8 3.2h2.7v11.6h-2.7M7.4 6.2h3.2M7.4 11.8h3.2" />;
    case 10:
      return (
        <>
          <path d="M5 3.2v8.6c0 1.6 1 2.5 2.5 2.5H13M5 7h5.5c1.5 0 2.5-1 2.5-2.5V3.2" />
          <circle className="is-filled" cx="5" cy="3.2" r="1.2" />
          <circle className="is-filled" cx="13" cy="3.2" r="1.2" />
          <circle className="is-filled" cx="13" cy="14.3" r="1.2" />
        </>
      );
    case 11:
      return <path d="m3.2 6 5.8-3 5.8 3L9 9 3.2 6Zm0 4L9 13l5.8-3M3.2 13.4 9 16l5.8-2.6" />;
    case 12:
      return (
        <>
          <path d="M9 2.3v3M9 12.7v3M2.3 9h3M12.7 9h3" />
          <circle cx="9" cy="9" r="3.4" />
        </>
      );
    case 13:
      return <path d="M4.2 2.8c2 1.8 2 3.6 0 5.4s-2 3.6 0 5.4M9 2.8c2 1.8 2 3.6 0 5.4s-2 3.6 0 5.4M13.8 2.8c2 1.8 2 3.6 0 5.4s-2 3.6 0 5.4" />;
    case 14:
      return <path d="M2.8 13.8h3V11h3V8.2h3V5.4h3V2.6" />;
    default:
      return (
        <>
          <rect x="2.7" y="5.4" width="12.6" height="7.2" rx="3.6" />
          <path d="M6.2 5.4v7.2M11.8 5.4v7.2" />
        </>
      );
  }
}

export function RepositoryMark({
  repository,
  size = "list",
  visual = repositoryMarkVisual(repository.id),
}: {
  repository: RepositorySummary;
  size?: "list" | "header";
  visual?: RepositoryMarkVisual;
}) {
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
