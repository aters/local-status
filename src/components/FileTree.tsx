import { ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import { useMemo, useState } from "react";

interface TreeNode {
  name: string;
  path: string;
  file: boolean;
  children: TreeNode[];
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", file: false, children: [] };
  for (const path of paths) {
    const parts = path.split("/");
    let current = root;
    parts.forEach((part, index) => {
      const nodePath = parts.slice(0, index + 1).join("/");
      let child = current.children.find((entry) => entry.name === part);
      if (!child) {
        child = {
          name: part,
          path: nodePath,
          file: index === parts.length - 1,
          children: [],
        };
        current.children.push(child);
      }
      current = child;
    });
  }

  const sort = (nodes: TreeNode[]) => {
    nodes.sort(
      (left, right) =>
        Number(left.file) - Number(right.file) || left.name.localeCompare(right.name),
    );
    nodes.forEach((node) => sort(node.children));
  };
  sort(root.children);
  return root.children;
}

function TreeRow({
  node,
  depth,
  expanded,
  selectedPath,
  onToggle,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  selectedPath: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const isExpanded = expanded.has(node.path);
  return (
    <>
      <button
        type="button"
        className={`tree-row ${node.path === selectedPath ? "is-selected" : ""}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => (node.file ? onSelect(node.path) : onToggle(node.path))}
        title={node.path}
      >
        {node.file ? (
          <span className="tree-spacer" />
        ) : (
          <ChevronRight
            className={`tree-chevron ${isExpanded ? "is-open" : ""}`}
            size={13}
          />
        )}
        {node.file ? (
          <File className="tree-file-icon" size={14} />
        ) : isExpanded ? (
          <FolderOpen className="tree-folder-icon" size={14} />
        ) : (
          <Folder className="tree-folder-icon" size={14} />
        )}
        <span>{node.name}</span>
      </button>
      {!node.file &&
        isExpanded &&
        node.children.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            selectedPath={selectedPath}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}

export function FileTree({
  paths,
  selectedPath,
  onSelect,
}: {
  paths: string[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const nodes = useMemo(() => buildTree(paths), [paths]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(path: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <div className="file-tree" role="tree" aria-label="Repository files">
      {nodes.map((node) => (
        <TreeRow
          key={node.path}
          node={node}
          depth={0}
          expanded={expanded}
          selectedPath={selectedPath}
          onToggle={toggle}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
