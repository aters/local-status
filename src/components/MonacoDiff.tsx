import { DiffEditor } from "@monaco-editor/react";
import {
  ArrowDown,
  ArrowUp,
  Code2,
  Columns2,
  Eye,
  Rows3,
  Search,
  WrapText,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MONACO_THEMES } from "../editor-themes";
import "../monaco";
import type { Comparison, ResolvedColorScheme, Theme } from "../types";

type DiffEditorInstance = editor.IStandaloneDiffEditor;

function revealChange(
  instance: DiffEditorInstance,
  change: editor.ILineChange,
) {
  const modifiedLine =
    change.modifiedStartLineNumber ||
    change.modifiedEndLineNumber ||
    change.originalStartLineNumber ||
    1;
  const originalLine =
    change.originalStartLineNumber ||
    change.originalEndLineNumber ||
    change.modifiedStartLineNumber ||
    1;
  instance.getModifiedEditor().revealLineInCenter(modifiedLine);
  instance.getOriginalEditor().revealLineInCenter(originalLine);
}

function loadBoolean(key: string, fallback: boolean) {
  const value = window.localStorage.getItem(key);
  return value === null ? fallback : value === "true";
}

export default function MonacoDiff({
  comparison,
  theme = "green",
  colorScheme = "dark",
  findRequest = 0,
}: {
  comparison: Comparison;
  theme?: Theme;
  colorScheme?: ResolvedColorScheme;
  findRequest?: number;
}) {
  const editorRef = useRef<DiffEditorInstance | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewFindInputRef = useRef<HTMLInputElement>(null);
  const previewMatchesRef = useRef<Range[]>([]);
  const diffUpdateSubscriptionRef = useRef<{ dispose(): void } | null>(null);
  const autoRevealFrameRef = useRef<number | null>(null);
  const revealedComparisonRef = useRef<string | null>(null);
  const changeIndex = useRef(-1);
  const comparisonKey = [
    comparison.repositoryId,
    comparison.path,
    comparison.original.source,
    comparison.modified.source,
  ].join(":");
  const comparisonKeyRef = useRef(comparisonKey);
  const [sideBySide, setSideBySide] = useState(() =>
    loadBoolean("local-status:side-by-side", true),
  );
  const [wrap, setWrap] = useState(() => loadBoolean("local-status:wrap", false));
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(() =>
    loadBoolean("local-status:ignore-whitespace", false),
  );
  const [markdownPreview, setMarkdownPreview] = useState(() =>
    loadBoolean("local-status:markdown-preview", false),
  );
  const [previewFindOpen, setPreviewFindOpen] = useState(false);
  const [previewFindQuery, setPreviewFindQuery] = useState("");
  const [previewMatchCount, setPreviewMatchCount] = useState(0);
  const [previewMatchIndex, setPreviewMatchIndex] = useState(0);
  const [editorReady, setEditorReady] = useState(false);

  useEffect(() => {
    window.localStorage.setItem("local-status:side-by-side", String(sideBySide));
  }, [sideBySide]);
  useEffect(() => {
    window.localStorage.setItem("local-status:wrap", String(wrap));
  }, [wrap]);
  useEffect(() => {
    window.localStorage.setItem(
      "local-status:ignore-whitespace",
      String(ignoreWhitespace),
    );
  }, [ignoreWhitespace]);
  useEffect(() => {
    window.localStorage.setItem(
      "local-status:markdown-preview",
      String(markdownPreview),
    );
  }, [markdownPreview]);
  useEffect(() => {
    changeIndex.current = -1;
  }, [comparison.path, comparison.original.content, comparison.modified.content]);

  const revealFirstPendingChange = useCallback(() => {
    const instance = editorRef.current;
    const key = comparisonKeyRef.current;
    if (!instance || revealedComparisonRef.current === key) return;
    const firstChange = instance.getLineChanges()?.[0];
    if (!firstChange) return;
    revealChange(instance, firstChange);
    changeIndex.current = 0;
    revealedComparisonRef.current = key;
  }, []);

  useEffect(() => {
    comparisonKeyRef.current = comparisonKey;
    if (autoRevealFrameRef.current !== null) {
      window.cancelAnimationFrame(autoRevealFrameRef.current);
    }
    autoRevealFrameRef.current = window.requestAnimationFrame(() => {
      autoRevealFrameRef.current = null;
      revealFirstPendingChange();
    });
    return () => {
      if (autoRevealFrameRef.current !== null) {
        window.cancelAnimationFrame(autoRevealFrameRef.current);
        autoRevealFrameRef.current = null;
      }
    };
  }, [comparisonKey, revealFirstPendingChange]);

  useEffect(
    () => () => {
      diffUpdateSubscriptionRef.current?.dispose();
      diffUpdateSubscriptionRef.current = null;
      editorRef.current = null;
    },
    [],
  );

  const goToChange = useCallback((direction: 1 | -1) => {
    const instance = editorRef.current;
    const changes = instance?.getLineChanges() ?? [];
    if (!changes.length || !instance) return;
    changeIndex.current =
      (changeIndex.current + direction + changes.length) % changes.length;
    revealChange(instance, changes[changeIndex.current]);
  }, []);

  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      if (event.key !== "F7") return;
      event.preventDefault();
      goToChange(event.shiftKey ? -1 : 1);
    };
    window.addEventListener("keydown", navigate);
    return () => window.removeEventListener("keydown", navigate);
  }, [goToChange]);

  const unavailable = comparison.original.binary || comparison.modified.binary;
  const isMarkdown =
    comparison.language === "markdown" ||
    /\.(?:md|markdown|mdown|mkd)$/i.test(comparison.path);
  const showMarkdownPreview = isMarkdown && !unavailable && markdownPreview;
  const previewSide =
    comparison.modified.missing && !comparison.original.missing
      ? comparison.original
      : comparison.modified;

  const clearPreviewHighlights = useCallback(() => {
    const css = globalThis.CSS as
      | (typeof CSS & {
          highlights?: { delete(name: string): void };
        })
      | undefined;
    css?.highlights?.delete("local-status-find");
    css?.highlights?.delete("local-status-find-active");
  }, []);

  const paintPreviewHighlights = useCallback(
    (activeIndex: number) => {
      clearPreviewHighlights();
      const ranges = previewMatchesRef.current;
      const HighlightConstructor = (
        window as typeof window & {
          Highlight?: new (...ranges: Range[]) => unknown;
        }
      ).Highlight;
      const css = globalThis.CSS as
        | (typeof CSS & {
            highlights?: { set(name: string, highlight: unknown): void };
          })
        | undefined;
      const registry = css?.highlights;
      if (!HighlightConstructor || !registry || !ranges.length) return;
      const active = ranges[activeIndex];
      registry.set(
        "local-status-find",
        new HighlightConstructor(...ranges.filter((range) => range !== active)),
      );
      if (active) {
        registry.set(
          "local-status-find-active",
          new HighlightConstructor(active),
        );
      }
    },
    [clearPreviewHighlights],
  );

  useEffect(() => {
    if (!previewFindOpen || !previewFindQuery.trim() || !previewRef.current) {
      previewMatchesRef.current = [];
      setPreviewMatchCount(0);
      setPreviewMatchIndex(0);
      clearPreviewHighlights();
      return;
    }
    const query = previewFindQuery.toLowerCase();
    const walker = document.createTreeWalker(
      previewRef.current,
      NodeFilter.SHOW_TEXT,
    );
    const ranges: Range[] = [];
    let node = walker.nextNode();
    while (node && ranges.length < 500) {
      const content = node.textContent || "";
      const normalized = content.toLowerCase();
      let offset = 0;
      while (offset < normalized.length && ranges.length < 500) {
        const match = normalized.indexOf(query, offset);
        if (match < 0) break;
        const range = document.createRange();
        range.setStart(node, match);
        range.setEnd(node, match + query.length);
        ranges.push(range);
        offset = match + Math.max(query.length, 1);
      }
      node = walker.nextNode();
    }
    previewMatchesRef.current = ranges;
    setPreviewMatchCount(ranges.length);
    setPreviewMatchIndex(0);
    paintPreviewHighlights(0);
  }, [
    clearPreviewHighlights,
    paintPreviewHighlights,
    previewFindOpen,
    previewFindQuery,
    previewSide.content,
  ]);

  useEffect(
    () => () => {
      clearPreviewHighlights();
    },
    [clearPreviewHighlights],
  );

  function revealPreviewMatch(index: number) {
    const ranges = previewMatchesRef.current;
    if (!ranges.length) return;
    const next = (index + ranges.length) % ranges.length;
    setPreviewMatchIndex(next);
    paintPreviewHighlights(next);
    ranges[next]?.startContainer.parentElement?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }

  useEffect(() => {
    if (!findRequest) return;
    if (showMarkdownPreview) {
      setPreviewFindOpen(true);
      return;
    }
    const instance = editorRef.current;
    if (!instance) return;
    const original = instance.getOriginalEditor();
    const modified = instance.getModifiedEditor();
    const target = original.hasTextFocus() ? original : modified;
    target.focus();
    void target.getAction("actions.find")?.run();
  }, [editorReady, findRequest, showMarkdownPreview]);

  useEffect(() => {
    if (previewFindOpen) previewFindInputRef.current?.focus();
  }, [previewFindOpen]);

  return (
    <div className="diff-shell">
      <div className="diff-toolbar">
        <div className="diff-labels" aria-label="Compared versions">
          <span>{comparison.original.label}</span>
          <span aria-hidden="true">→</span>
          <span>{comparison.modified.label}</span>
        </div>
        <div className="diff-actions">
          {!showMarkdownPreview && (
            <>
              <button
                className="toolbar-button"
                type="button"
                onClick={() => goToChange(-1)}
                title="Previous change"
              >
                <ArrowUp size={15} />
                <span className="button-label">Previous</span>
              </button>
              <button
                className="toolbar-button"
                type="button"
                onClick={() => goToChange(1)}
                title="Next change"
              >
                <ArrowDown size={15} />
                <span className="button-label">Next</span>
              </button>
              <span className="toolbar-divider" />
              <button
                className={`toolbar-button ${wrap ? "is-active" : ""}`}
                type="button"
                aria-pressed={wrap}
                onClick={() => setWrap((current) => !current)}
                title="Toggle line wrapping"
              >
                <WrapText size={15} />
                <span className="button-label">Wrap</span>
              </button>
              <button
                className={`toolbar-button ${ignoreWhitespace ? "is-active" : ""}`}
                type="button"
                aria-pressed={ignoreWhitespace}
                onClick={() => setIgnoreWhitespace((current) => !current)}
                title="Ignore leading and trailing whitespace"
              >
                <span className="whitespace-icon">¶</span>
                <span className="button-label">Whitespace</span>
              </button>
              <button
                className="toolbar-button view-toggle"
                type="button"
                onClick={() => setSideBySide((current) => !current)}
                title={
                  sideBySide
                    ? "Switch to inline diff"
                    : "Switch to side-by-side diff"
                }
              >
                {sideBySide ? <Rows3 size={15} /> : <Columns2 size={15} />}
                <span className="button-label">
                  {sideBySide ? "Inline" : "Side by side"}
                </span>
              </button>
            </>
          )}
          {isMarkdown && !unavailable && (
            <>
              {!showMarkdownPreview && <span className="toolbar-divider" />}
              <button
                className={`toolbar-button markdown-view-toggle ${
                  showMarkdownPreview ? "is-active" : ""
                }`}
                type="button"
                aria-pressed={showMarkdownPreview}
                onClick={() => setMarkdownPreview((current) => !current)}
                title={
                  showMarkdownPreview
                    ? "Show Markdown source comparison"
                    : "Preview rendered Markdown"
                }
              >
                {showMarkdownPreview ? <Code2 size={15} /> : <Eye size={15} />}
                <span className="button-label">
                  {showMarkdownPreview ? "Source" : "Preview"}
                </span>
              </button>
            </>
          )}
        </div>
      </div>

      {(comparison.original.truncated || comparison.modified.truncated) && (
        <div className="viewer-notice">
          Preview limited to the first 1 MB to keep the workspace responsive.
        </div>
      )}
      {showMarkdownPreview && previewFindOpen && (
        <div className="markdown-find">
          <Search size={14} />
          <input
            ref={previewFindInputRef}
            value={previewFindQuery}
            onChange={(event) => setPreviewFindQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                revealPreviewMatch(
                  previewMatchIndex + (event.shiftKey ? -1 : 1),
                );
              } else if (event.key === "Escape") {
                setPreviewFindOpen(false);
                setPreviewFindQuery("");
                window.requestAnimationFrame(() => previewRef.current?.focus());
              }
            }}
            placeholder="Find in preview"
            aria-label="Find in Markdown preview"
          />
          <span>
            {previewMatchCount
              ? `${previewMatchIndex + 1} / ${previewMatchCount}`
              : "No results"}
          </span>
          <button
            type="button"
            aria-label="Previous preview match"
            disabled={!previewMatchCount}
            onClick={() => revealPreviewMatch(previewMatchIndex - 1)}
          >
            <ArrowUp size={14} />
          </button>
          <button
            type="button"
            aria-label="Next preview match"
            disabled={!previewMatchCount}
            onClick={() => revealPreviewMatch(previewMatchIndex + 1)}
          >
            <ArrowDown size={14} />
          </button>
          <button
            type="button"
            aria-label="Close preview find"
            onClick={() => {
              setPreviewFindOpen(false);
              setPreviewFindQuery("");
              window.requestAnimationFrame(() => previewRef.current?.focus());
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {unavailable ? (
        <div className="viewer-empty">
          <span className="empty-orbit">01</span>
          <h3>Binary comparison unavailable</h3>
          <p>This file is tracked, but its contents cannot be shown as text.</p>
        </div>
      ) : showMarkdownPreview ? (
        <div className="markdown-preview-shell" ref={previewRef} tabIndex={-1}>
          <div className="markdown-preview-version">
            Previewing {previewSide.label}
          </div>
          {previewSide.content.trim() ? (
            <article className="markdown-preview">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                skipHtml
                components={{
                  a: ({ children, href }) => (
                    <span className="markdown-preview__link" title={href}>
                      {children}
                    </span>
                  ),
                  img: ({ alt }) => (
                    <span className="markdown-preview__image" role="img">
                      Image{alt ? `: ${alt}` : ""}
                    </span>
                  ),
                }}
              >
                {previewSide.content}
              </ReactMarkdown>
            </article>
          ) : (
            <div className="viewer-empty">
              <h3>Empty Markdown file</h3>
              <p>There is no content to preview in this version.</p>
            </div>
          )}
        </div>
      ) : (
        <DiffEditor
          height="100%"
          language={comparison.language}
          originalModelPath={`inmemory://local-status/${encodeURIComponent(comparison.repositoryId)}/${encodeURIComponent(comparison.original.source)}/${encodeURIComponent(comparison.path)}`}
          modifiedModelPath={`inmemory://local-status/${encodeURIComponent(comparison.repositoryId)}/${encodeURIComponent(comparison.modified.source)}/${encodeURIComponent(comparison.path)}`}
          original={comparison.original.content}
          modified={comparison.modified.content}
          theme={`local-status-${theme}-${colorScheme}`}
          beforeMount={(monacoInstance) => {
            for (const [themeId, definitions] of Object.entries(MONACO_THEMES)) {
              for (const [scheme, definition] of Object.entries(definitions)) {
                monacoInstance.editor.defineTheme(
                  `local-status-${themeId}-${scheme}`,
                  definition,
                );
              }
            }
          }}
          onMount={(instance) => {
            editorRef.current = instance;
            setEditorReady(true);
            diffUpdateSubscriptionRef.current?.dispose();
            diffUpdateSubscriptionRef.current = instance.onDidUpdateDiff(
              revealFirstPendingChange,
            );
            revealFirstPendingChange();
          }}
          options={{
            readOnly: true,
            originalEditable: false,
            automaticLayout: true,
            renderSideBySide: sideBySide,
            useInlineViewWhenSpaceIsLimited: true,
            renderSideBySideInlineBreakpoint: 520,
            splitViewDefaultRatio: 0.5,
            ignoreTrimWhitespace: ignoreWhitespace,
            wordWrap: wrap ? "on" : "off",
            diffWordWrap: wrap ? "on" : "off",
            minimap: { enabled: false },
            fontFamily:
              '"DM Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
            fontSize: 14,
            lineHeight: 20,
            lineNumbersMinChars: 3,
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            renderOverviewRuler: true,
            renderMarginRevertIcon: false,
            glyphMargin: false,
            folding: true,
            padding: { top: 12, bottom: 16 },
            stickyScroll: { enabled: true },
            accessibilityVerbose: true,
          }}
        />
      )}
    </div>
  );
}
