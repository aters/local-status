import {
  AlertTriangle,
  ExternalLink,
  Eye,
  GitPullRequest,
  RefreshCw,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type {
  PullRequestSummary,
  PullRequestsResponse,
} from "../types";

const STALE_AFTER_MS = 30_000;
const responseCache = new Map<
  string,
  { data: PullRequestsResponse; loadedAt: number }
>();

function readableError(caught: unknown) {
  if (!(caught instanceof Error)) return "Pull requests could not be loaded.";
  return caught.message.replace(
    /^Error invoking remote method '[^']+': Error:\s*/i,
    "",
  );
}

function relativeTime(value: string) {
  const seconds = (new Date(value).getTime() - Date.now()) / 1_000;
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(Math.round(seconds), "second");
  const minutes = seconds / 60;
  if (Math.abs(minutes) < 60) return formatter.format(Math.round(minutes), "minute");
  const hours = minutes / 60;
  if (Math.abs(hours) < 24) return formatter.format(Math.round(hours), "hour");
  const days = hours / 24;
  return formatter.format(Math.round(days), "day");
}

function exactDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function PullRequestRow({
  pullRequest,
  opening,
  onOpen,
}: {
  pullRequest: PullRequestSummary;
  opening: boolean;
  onOpen: (pullRequest: PullRequestSummary) => Promise<void>;
}) {
  return (
    <button
      className="pull-request-row"
      type="button"
      disabled={opening}
      aria-label={`Open ${pullRequest.repository} pull request ${pullRequest.number}: ${pullRequest.title}`}
      onClick={() => void onOpen(pullRequest)}
    >
      <span className="pull-request-row__identity">
        <strong>{pullRequest.repository}</strong>
        <small>#{pullRequest.number}</small>
      </span>
      <span className="pull-request-row__title">{pullRequest.title}</span>
      <span className="pull-request-row__meta">
        <span>
          <UserRound size={13} />
          {pullRequest.author}
        </span>
        <span
          title={exactDate(pullRequest.updatedAt)}
          aria-label={`Updated ${exactDate(pullRequest.updatedAt)}`}
        >
          Updated {relativeTime(pullRequest.updatedAt)}
        </span>
      </span>
      <span
        className={`pull-request-badge ${
          pullRequest.isDraft ? "is-draft" : "is-open"
        }`}
      >
        {pullRequest.isDraft ? "Draft" : "Open"}
      </span>
      <ExternalLink size={15} aria-hidden="true" />
    </button>
  );
}

function PullRequestSection({
  title,
  description,
  pullRequests,
  emptyMessage,
  icon,
  openingUrl,
  onOpen,
}: {
  title: string;
  description: string;
  pullRequests: PullRequestSummary[];
  emptyMessage: string;
  icon: React.ReactNode;
  openingUrl: string | null;
  onOpen: (pullRequest: PullRequestSummary) => Promise<void>;
}) {
  return (
    <section className="pull-request-section" aria-labelledby={`${title}-title`}>
      <header>
        <span className="pull-request-section__icon">{icon}</span>
        <span>
          <strong id={`${title}-title`}>{title}</strong>
          <small>{description}</small>
        </span>
        <span className="pull-request-section__count">{pullRequests.length}</span>
      </header>
      {pullRequests.length ? (
        <div className="pull-request-list">
          {pullRequests.map((pullRequest) => (
            <PullRequestRow
              key={pullRequest.url}
              pullRequest={pullRequest}
              opening={openingUrl === pullRequest.url}
              onOpen={onOpen}
            />
          ))}
        </div>
      ) : (
        <div className="pull-request-section__empty">{emptyMessage}</div>
      )}
    </section>
  );
}

function LoadingState() {
  return (
    <div className="pull-requests-loading" aria-label="Loading pull requests">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  const missing = /not found|install gh/i.test(error);
  const signedOut = /not signed in|auth login/i.test(error);
  return (
    <div className="pull-requests-state is-error" role="alert">
      <AlertTriangle size={26} />
      <strong>
        {missing
          ? "GitHub CLI is required"
          : signedOut
            ? "Sign in to GitHub CLI"
            : "Pull requests could not be loaded"}
      </strong>
      <span>{error}</span>
      {(missing || signedOut) && (
        <code>{missing ? "brew install gh" : "gh auth login"}</code>
      )}
      <button className="secondary-button" type="button" onClick={onRetry}>
        <RefreshCw size={14} />
        Try again
      </button>
    </div>
  );
}

export function PullRequestsView({
  workspacePath,
}: {
  workspacePath: string;
}) {
  const cached = responseCache.get(workspacePath);
  const [data, setData] = useState<PullRequestsResponse | null>(
    () => cached?.data ?? null,
  );
  const [loading, setLoading] = useState(() => !cached);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [openingUrl, setOpeningUrl] = useState<string | null>(null);
  const requestId = useRef(0);
  const loadedAt = useRef(cached?.loadedAt ?? 0);
  const hasLoaded = useRef(Boolean(cached));

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    if (hasLoaded.current) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await api.pullRequests();
      if (requestId.current !== currentRequest) return;
      setData(response);
      hasLoaded.current = true;
      loadedAt.current = Date.now();
      responseCache.set(workspacePath, {
        data: response,
        loadedAt: loadedAt.current,
      });
    } catch (caught) {
      if (requestId.current !== currentRequest) return;
      setError(readableError(caught));
    } finally {
      if (requestId.current === currentRequest) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [workspacePath]);

  useEffect(() => {
    setError(null);
    setActionError(null);
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  useEffect(() => {
    const refreshIfStale = () => {
      if (Date.now() - loadedAt.current >= STALE_AFTER_MS) void load();
    };
    window.addEventListener("focus", refreshIfStale);
    return () => window.removeEventListener("focus", refreshIfStale);
  }, [load]);

  async function openPullRequest(pullRequest: PullRequestSummary) {
    setOpeningUrl(pullRequest.url);
    setActionError(null);
    try {
      await api.openPullRequest(pullRequest.url);
    } catch (caught) {
      setActionError(readableError(caught));
    } finally {
      setOpeningUrl(null);
    }
  }

  const total =
    (data?.createdByMe.length ?? 0) + (data?.reviewRequested.length ?? 0);

  return (
    <main className="pull-requests-workspace">
      <header className="pull-requests-toolbar">
        <div>
          <p className="eyebrow">GitHub workspace</p>
          <h1>Pull Requests</h1>
          <span>
            {data
              ? `${total} active · ${data.createdByMe.length} created · ${data.reviewRequested.length} awaiting review`
              : "Open work across this workspace"}
          </span>
        </div>
        <div className="pull-requests-toolbar__account">
          {data && <span>@{data.account}</span>}
          <button
            className="secondary-button"
            type="button"
            disabled={loading || refreshing}
            onClick={() => void load()}
          >
            <RefreshCw
              className={loading || refreshing ? "is-spinning" : undefined}
              size={14}
            />
            Refresh
          </button>
        </div>
      </header>

      {actionError && (
        <div className="pull-requests-alert is-error" role="alert">
          <AlertTriangle size={15} />
          <span>{actionError}</span>
        </div>
      )}
      {error && data && (
        <div className="pull-requests-alert is-error" role="alert">
          <AlertTriangle size={15} />
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      {data && data.skippedRepositories.length > 0 && (
        <div
          className="pull-requests-alert"
          title={data.skippedRepositories.join(", ")}
        >
          <AlertTriangle size={15} />
          <span>
            Skipped {data.skippedRepositories.length} non-GitHub or inaccessible{" "}
            {data.skippedRepositories.length === 1
              ? "repository"
              : "repositories"}
            .
          </span>
        </div>
      )}

      <div className="pull-requests-content">
        {loading && !data ? (
          <LoadingState />
        ) : error && !data ? (
          <ErrorState error={error} onRetry={() => void load()} />
        ) : data?.repositoryCount === 0 ? (
          <div className="pull-requests-state">
            <GitPullRequest size={28} />
            <strong>No github.com repositories</strong>
            <span>
              This workspace does not contain an accessible, non-archived
              github.com repository.
            </span>
          </div>
        ) : data && total === 0 ? (
          <div className="pull-requests-state">
            <GitPullRequest size={28} />
            <strong>No active pull requests</strong>
            <span>
              @{data.account} has no open pull requests or pending review
              requests in this workspace.
            </span>
          </div>
        ) : data ? (
          <div className="pull-request-sections">
            <PullRequestSection
              title="Created by me"
              description="Open pull requests authored by you"
              pullRequests={data.createdByMe}
              emptyMessage="You have no open pull requests in this workspace."
              icon={<UserRound size={17} />}
              openingUrl={openingUrl}
              onOpen={openPullRequest}
            />
            <PullRequestSection
              title="Review requested"
              description="Pull requests waiting for your review"
              pullRequests={data.reviewRequested}
              emptyMessage="No pull requests are waiting for your review."
              icon={<Eye size={17} />}
              openingUrl={openingUrl}
              onOpen={openPullRequest}
            />
          </div>
        ) : null}
      </div>
    </main>
  );
}
