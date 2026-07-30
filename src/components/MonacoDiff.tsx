import { DiffEditor } from "@monaco-editor/react";
import {
  ArrowDown,
  ArrowUp,
  Code2,
  Columns2,
  Eye,
  Rows3,
  WrapText,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "../monaco";
import type { Comparison, Theme } from "../types";

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
}: {
  comparison: Comparison;
  theme?: Theme;
}) {
  const editorRef = useRef<DiffEditorInstance | null>(null);
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
      {unavailable ? (
        <div className="viewer-empty">
          <span className="empty-orbit">01</span>
          <h3>Binary comparison unavailable</h3>
          <p>This file is tracked, but its contents cannot be shown as text.</p>
        </div>
      ) : showMarkdownPreview ? (
        <div className="markdown-preview-shell">
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
          theme={`local-status-${theme}`}
          beforeMount={(monacoInstance) => {
            monacoInstance.editor.defineTheme("local-status-green", {
              base: "vs-dark",
              inherit: true,
              rules: [],
              colors: {
                "editor.background": "#0a1210",
                "editorGutter.background": "#0a1210",
                "editorLineNumber.foreground": "#496057",
                "editorLineNumber.activeForeground": "#9bb5aa",
                "diffEditor.insertedTextBackground": "#1f7a5242",
                "diffEditor.removedTextBackground": "#b64b5542",
                "diffEditor.insertedLineBackground": "#123b2b88",
                "diffEditor.removedLineBackground": "#3d202588",
                "diffEditor.diagonalFill": "#18231f",
                "editorOverviewRuler.addedForeground": "#67dba0",
                "editorOverviewRuler.deletedForeground": "#f2777f",
                "scrollbarSlider.background": "#66807433",
                "scrollbarSlider.hoverBackground": "#78998a66",
              },
            });
            monacoInstance.editor.defineTheme("local-status-dark", {
              base: "vs-dark",
              inherit: true,
              rules: [],
              colors: {
                "editor.background": "#171717",
                "editorGutter.background": "#171717",
                "editorLineNumber.foreground": "#737373",
                "editorLineNumber.activeForeground": "#d4d4d4",
                "diffEditor.insertedTextBackground": "#2f7d4d55",
                "diffEditor.removedTextBackground": "#a94c5555",
                "diffEditor.insertedLineBackground": "#173d2788",
                "diffEditor.removedLineBackground": "#43232988",
                "diffEditor.diagonalFill": "#262626",
                "editorOverviewRuler.addedForeground": "#57c785",
                "editorOverviewRuler.deletedForeground": "#ef7a82",
                "scrollbarSlider.background": "#77777733",
                "scrollbarSlider.hoverBackground": "#99999966",
              },
            });
            monacoInstance.editor.defineTheme("local-status-light", {
              base: "vs",
              inherit: true,
              rules: [],
              colors: {
                "editor.background": "#ffffff",
                "editorGutter.background": "#ffffff",
                "editorLineNumber.foreground": "#8b8b8b",
                "editorLineNumber.activeForeground": "#333333",
                "diffEditor.insertedTextBackground": "#60b8784a",
                "diffEditor.removedTextBackground": "#e06c754a",
                "diffEditor.insertedLineBackground": "#dff4e688",
                "diffEditor.removedLineBackground": "#f9dfe288",
                "diffEditor.diagonalFill": "#eeeeee",
                "editorOverviewRuler.addedForeground": "#258a52",
                "editorOverviewRuler.deletedForeground": "#c44550",
                "scrollbarSlider.background": "#77777733",
                "scrollbarSlider.hoverBackground": "#66666655",
              },
            });
          }}
          onMount={(instance) => {
            editorRef.current = instance;
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
