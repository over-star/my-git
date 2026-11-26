import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  GitBranch,
  GitCommitHorizontal,
  Copy,
  Columns2,
  AlignJustify,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Tag as TagIcon,
  ExternalLink,
  RotateCcw,
  History,
  Folder,
  FolderTree,
  FileCode2,
  FileArchive,
} from "lucide-react";
import type {
  BranchInfo,
  CommitDetail,
  CommitFileContent,
  CommitItem,
  CommitTreeEntry,
  FileDiff,
  RepoLocation,
  TagInfo,
} from "../../bindings/gitpulse/internal/git/models";
import { GitService } from "../../bindings/gitpulse";
import { computeCommitGraph } from "../utils/dag";
import { DiffViewer } from "./DiffViewer";
import { StatusBadge, formatBytes } from "./StatusBadge";
import { SplitHandle } from "./SplitHandle";
import { DEFAULT_LAYOUT, clamp } from "../utils/layout";

interface HistoryViewProps {
  repo: RepoLocation;
  branches: BranchInfo[];
  tags?: TagInfo[];
  selectedBranch: string;
  onSelectBranch: (branch: string) => void;
  focusCommitSignal?: { sha: string; nonce: number } | null;
  refreshKey: number;
  externalSearch?: string;
  defaultIgnoreWhitespace?: boolean;
  bottomRatio: number;
  detailLeftRatio: number;
  onChangeRatios: (
    patch: { historyBottomRatio?: number; historyDetailLeftRatio?: number },
    persist: boolean
  ) => void;
  onCreateBranchFromCommit: (sha: string) => void;
  onCreateTagFromCommit: (sha: string) => void;
  onCreateWorktreeFromCommit: (sha: string) => void;
  onRequestRevertCommit: (commit: CommitItem) => void;
  onRequestResetCommit: (commit: CommitItem) => void;
  onNotify: (type: "success" | "error" | "info", msg: string) => void;
}

interface TreeNode<T> {
  name: string;
  path: string;
  children: TreeNode<T>[];
  file?: T;
  fileCount: number;
}

function buildFileTree<T extends { path: string }>(items: T[]): TreeNode<T>[] {
  const root: TreeNode<T> = { name: "", path: "", children: [], fileCount: 0 };

  for (const item of items) {
    const parts = item.path.split("/").filter(Boolean);
    let cur = root;
    cur.fileCount++;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const nodePath = parts.slice(0, i + 1).join("/");
      let next = cur.children.find(
        (c) => c.name === part && (isLast ? !!c.file : !c.file)
      );
      if (!next) {
        next = {
          name: part,
          path: nodePath,
          children: [],
          file: isLast ? item : undefined,
          fileCount: isLast ? 1 : 0,
        };
        cur.children.push(next);
      } else if (!isLast) {
        next.fileCount++;
      }
      cur = next;
    }
  }

  const sortNodes = (nodes: TreeNode<T>[]) => {
    nodes.sort((a, b) => {
      const aDir = !a.file;
      const bDir = !b.file;
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.children.length > 0) sortNodes(n.children);
    }
  };
  sortNodes(root.children);
  return root.children;
}

const PAGE_SIZE = 100;
const ROW_HEIGHT = 32;
const LANE_SPACING = 14;

export const HistoryView: React.FC<HistoryViewProps> = ({
  repo,
  branches,
  tags = [],
  selectedBranch,
  onSelectBranch,
  focusCommitSignal,
  refreshKey,
  externalSearch,
  defaultIgnoreWhitespace = false,
  bottomRatio,
  detailLeftRatio,
  onChangeRatios,
  onCreateBranchFromCommit,
  onCreateTagFromCommit,
  onCreateWorktreeFromCommit,
  onRequestRevertCommit,
  onRequestResetCommit,
  onNotify,
}) => {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [commits, setCommits] = useState<CommitItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileDiff, setFileDiff] = useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffMode, setDiffMode] = useState<"unified" | "split">("unified");
  const [ignoreWs, setIgnoreWs] = useState(defaultIgnoreWhitespace);

  useEffect(() => {
    setIgnoreWs(defaultIgnoreWhitespace);
  }, [defaultIgnoreWhitespace]);

  // Commit inspector tab ("commit" | "changes" | "all") & right-pane scope ("changed" | "all")
  const [inspectTab, setInspectTab] = useState<"commit" | "changes" | "all">(
    "changes"
  );
  const [fileScope, setFileScope] = useState<"changed" | "all">("changed");
  const [fileFilter, setFileFilter] = useState("");
  const [treeEntries, setTreeEntries] = useState<CommitTreeEntry[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  const [snapshotContent, setSnapshotContent] = useState<CommitFileContent | null>(
    null
  );
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  // Virtual scroll state for commit list
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    commit: CommitItem;
  } | null>(null);

  const topPaneRef = useRef<HTMLDivElement>(null);
  const bottomPaneRef = useRef<HTMLDivElement>(null);
  const detailLeftRef = useRef<HTMLDivElement>(null);
  const detailRightRef = useRef<HTMLDivElement>(null);
  const commitsCountRef = useRef(0);
  const prevQueryKeyRef = useRef("");
  const loadedQueryKeyRef = useRef("");
  const lastHandledFocusNonceRef = useRef<number | null>(null);
  const vDragRef = useRef<{ startPx: number; totalPx: number }>({
    startPx: 0,
    totalPx: 1,
  });
  const hDragRef = useRef<{ startPx: number; totalPx: number }>({
    startPx: 0,
    totalPx: 1,
  });

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu]);

  useEffect(() => {
    if (externalSearch !== undefined && externalSearch !== searchInput) {
      setSearchInput(externalSearch);
    }
  }, [externalSearch]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 220);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Load commits when repo, branch, search, or refreshKey changes;
  // preserve pagination depth and selected commit across background refreshes.
  useEffect(() => {
    let cancelled = false;
    const queryKey = `${repo.path}\0${selectedBranch}\0${debouncedSearch}`;
    const isQueryChanged = prevQueryKeyRef.current !== queryKey;
    prevQueryKeyRef.current = queryKey;
    const limit = isQueryChanged
      ? PAGE_SIZE
      : Math.max(PAGE_SIZE, commitsCountRef.current);

    setLoading(true);
    GitService.GetCommitHistory(
      repo.path,
      selectedBranch,
      debouncedSearch,
      0,
      limit
    )
      .then((page) => {
        if (cancelled) return;
        const list = page.commits ?? [];
        commitsCountRef.current = list.length;
        loadedQueryKeyRef.current = queryKey;
        setCommits(list);
        setHasMore(page.hasMore);
        if (list.length > 0) {
          setSelectedHash((prev) =>
            prev && list.some((c) => c.hash === prev) ? prev : list[0].hash
          );
        } else {
          setSelectedHash(null);
          setDetail(null);
        }
      })
      .catch((err) => {
        if (!cancelled) onNotify("error", `Failed to load history: ${err}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo.path, selectedBranch, debouncedSearch, refreshKey]);

  // Focus and scroll to a specific commit once per signal (e.g. clicking a branch in All Commits mode)
  useEffect(() => {
    const queryKey = `${repo.path}\0${selectedBranch}\0${debouncedSearch}`;
    if (
      !focusCommitSignal?.sha ||
      loading ||
      loadedQueryKeyRef.current !== queryKey ||
      commits.length === 0
    ) {
      return;
    }
    if (focusCommitSignal.nonce === lastHandledFocusNonceRef.current) {
      return;
    }
    lastHandledFocusNonceRef.current = focusCommitSignal.nonce;
    const focusSha = focusCommitSignal.sha;
    const idx = commits.findIndex(
      (c) => c.hash.startsWith(focusSha) || c.shortHash === focusSha
    );
    if (idx < 0) return;
    setSelectedHash(commits[idx].hash);
    if (listRef.current) {
      const targetTop = Math.max(0, idx * ROW_HEIGHT - viewportHeight / 3);
      listRef.current.scrollTo({ top: targetTop, behavior: "smooth" });
    }
  }, [
    focusCommitSignal,
    commits,
    loading,
    repo.path,
    selectedBranch,
    debouncedSearch,
    viewportHeight,
  ]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const page = await GitService.GetCommitHistory(
        repo.path,
        selectedBranch,
        debouncedSearch,
        commits.length,
        PAGE_SIZE
      );
      setCommits((prev) => {
        const next = [...prev, ...(page.commits ?? [])];
        commitsCountRef.current = next.length;
        return next;
      });
      setHasMore(page.hasMore);
    } catch (err) {
      onNotify("error", `Load more failed: ${err}`);
    } finally {
      setLoadingMore(false);
    }
  };

  // Load commit detail + full file tree when selectedHash changes
  useEffect(() => {
    if (!selectedHash) {
      setDetail(null);
      setTreeEntries([]);
      setSelectedFile(null);
      setFileDiff(null);
      setSnapshotContent(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setTreeLoading(true);
    setExpandedDirs({});

    Promise.all([
      GitService.GetCommitDetail(repo.path, selectedHash),
      GitService.GetCommitTree(repo.path, selectedHash).catch(
        () => [] as CommitTreeEntry[]
      ),
    ])
      .then(([d, tree]) => {
        if (cancelled) return;
        setDetail(d);
        const tList = tree ?? [];
        setTreeEntries(tList);
        const changed = d.files ?? [];
        if (fileScope === "changed") {
          setSelectedFile(changed.length > 0 ? changed[0].path : null);
        } else {
          setSelectedFile(tList.length > 0 ? tList[0].path : null);
        }
      })
      .catch((err) => {
        if (!cancelled) onNotify("error", `Failed to load commit: ${err}`);
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false);
          setTreeLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repo.path, selectedHash]);

  // Load commit file diff OR snapshot content
  useEffect(() => {
    if (!selectedHash || !selectedFile) {
      setFileDiff(null);
      setSnapshotContent(null);
      return;
    }
    let cancelled = false;
    if (fileScope === "changed") {
      setDiffLoading(true);
      GitService.GetCommitFileDiff(repo.path, selectedHash, selectedFile, ignoreWs)
        .then((fd) => {
          if (!cancelled) setFileDiff(fd);
        })
        .catch((err) => {
          if (!cancelled)
            setFileDiff({
              path: selectedFile,
              oldPath: "",
              modeChange: "",
              isBinary: false,
              oldSize: 0,
              newSize: 0,
              additions: 0,
              deletions: 0,
              hunks: [],
              truncated: false,
              rawError: String(err),
            });
        })
        .finally(() => {
          if (!cancelled) setDiffLoading(false);
        });
    } else {
      setSnapshotLoading(true);
      GitService.GetCommitFileContent(repo.path, selectedHash, selectedFile)
        .then((fc) => {
          if (!cancelled) setSnapshotContent(fc);
        })
        .catch((err) => {
          if (!cancelled)
            setSnapshotContent({
              path: selectedFile,
              size: 0,
              isBinary: false,
              truncated: false,
              content: "",
              rawError: String(err),
            });
        })
        .finally(() => {
          if (!cancelled) setSnapshotLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [repo.path, selectedHash, selectedFile, ignoreWs, fileScope]);

  // Measure viewport for virtual window
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    ro.observe(el);
    setViewportHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const isSearchFiltered = debouncedSearch.trim().length > 0;
  const graphRows = useMemo(
    () => computeCommitGraph(commits, { isFiltered: isSearchFiltered }),
    [commits, isSearchFiltered]
  );
  const maxLanes = useMemo(() => {
    let m = 2;
    for (const r of graphRows) {
      if (r.maxLanes > m) m = r.maxLanes;
    }
    return Math.min(m, 24);
  }, [graphRows]);
  const graphColWidth = Math.max(68, maxLanes * LANE_SPACING + 20);

  const overscan = 12;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - overscan);
  const endIdx = Math.min(
    commits.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + overscan
  );

  const handleListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setScrollTop(el.scrollTop);
    if (
      hasMore &&
      !loadingMore &&
      el.scrollTop + el.clientHeight >= el.scrollHeight - 160
    ) {
      loadMore();
    }
  };

  const filteredChangedFiles = useMemo(() => {
    const list = detail?.files ?? [];
    if (!fileFilter.trim()) return list;
    const q = fileFilter.trim().toLowerCase();
    return list.filter((f) => f.path.toLowerCase().includes(q));
  }, [detail?.files, fileFilter]);

  const filteredTreeEntries = useMemo(() => {
    if (!fileFilter.trim()) return treeEntries;
    const q = fileFilter.trim().toLowerCase();
    return treeEntries.filter((f) => f.path.toLowerCase().includes(q));
  }, [treeEntries, fileFilter]);

  const allTree = useMemo(
    () => buildFileTree<CommitTreeEntry>(filteredTreeEntries),
    [filteredTreeEntries]
  );

  const toggleDir = (dirPath: string) => {
    setExpandedDirs((prev) => ({ ...prev, [dirPath]: !prev[dirPath] }));
  };

  const renderTreeNodes = (
    nodes: TreeNode<CommitTreeEntry>[],
    depth: number
  ): React.ReactNode => {
    return nodes.map((node) => {
      if (!node.file) {
        // Default collapsed unless explicitly expanded or filtering
        const isExpanded =
          Boolean(expandedDirs[node.path]) || Boolean(fileFilter.trim());
        return (
          <div key={`dir:${node.path}`}>
            <div
              onClick={() => toggleDir(node.path)}
              style={{ paddingLeft: 6 + depth * 12 }}
              className="flex items-center justify-between pr-2 py-1 rounded hover:bg-[#f8fafc] text-[#334155] cursor-pointer select-none"
            >
              <div className="flex items-center gap-1 min-w-0">
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-[#94a3b8] shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-[#94a3b8] shrink-0" />
                )}
                <Folder className="w-3.5 h-3.5 text-[#0284c7] shrink-0" />
                <span className="font-mono text-[12px] truncate">{node.name}</span>
              </div>
              <span className="font-mono text-[11px] text-[#94a3b8] shrink-0">
                {node.fileCount}
              </span>
            </div>
            {isExpanded && renderTreeNodes(node.children, depth + 1)}
          </div>
        );
      }

      const item = node.file;
      const active = item.path === selectedFile;
      return (
        <div
          key={`file:${item.path}`}
          onClick={() => setSelectedFile(item.path)}
          style={{ paddingLeft: 20 + depth * 12 }}
          title={item.path}
          className={`flex items-center justify-between pr-2 py-1 rounded cursor-pointer transition-colors ${
            active
              ? "bg-[#f0f9ff] text-[#0b1c30] font-medium"
              : "hover:bg-[#f8fafc] text-[#334155]"
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0 pr-2">
            <FileCode2 className="w-3.5 h-3.5 text-[#64748b] shrink-0" />
            <span className="font-mono text-[12px] truncate">{node.name}</span>
          </div>
          <span className="font-mono text-[11px] text-[#94a3b8] shrink-0">
            {formatBytes(item.size)}
          </span>
        </div>
      );
    });
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 p-2 bg-[#f8fafc]">
      {/* TOP HALF: Filter Toolbar + Commit DAG List */}
      <div
        ref={topPaneRef}
        className="flex-1 flex flex-col min-h-[160px] bg-white border border-[#e2e8f0] rounded-lg overflow-hidden"
      >
        {/* Filter bar */}
        <div className="h-9 px-3 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="relative flex items-center">
              <GitBranch className="w-3.5 h-3.5 text-[#0284c7] absolute left-2 pointer-events-none" />
              <select
                value={selectedBranch}
                onChange={(e) => onSelectBranch(e.target.value)}
                className="h-7 pl-7 pr-6 rounded bg-white border border-[#e2e8f0] text-[12px] font-medium text-[#0b1c30] outline-none focus:border-[#0284c7] appearance-none cursor-pointer max-w-[240px]"
              >
                <option value="__ALL__">All Branches ({branches.length})</option>
                {branches.map((b) => (
                  <option key={b.fullName} value={b.fullName}>
                    {b.isCurrent ? `● ${b.name}` : b.name}
                  </option>
                ))}
                {tags.length > 0 && (
                  <optgroup label={`Tags (${tags.length})`}>
                    {tags.map((t) => (
                      <option key={`tag:${t.name}`} value={`refs/tags/${t.name}`}>
                        Tag: {t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {selectedBranch !== "__ALL__" &&
                  !branches.some((b) => b.fullName === selectedBranch) &&
                  !tags.some((t) => `refs/tags/${t.name}` === selectedBranch) && (
                    <option value={selectedBranch}>{selectedBranch}</option>
                  )}
              </select>
              <ChevronDown className="w-3 h-3 text-[#64748b] absolute right-1.5 pointer-events-none" />
            </div>

            <div className="flex items-center flex-1 max-w-md h-7 bg-white border border-[#e2e8f0] focus-within:border-[#0284c7] rounded px-2">
              <Search className="w-3.5 h-3.5 text-[#94a3b8] mr-1.5 shrink-0" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search commit message, author, or hash..."
                className="w-full bg-transparent text-[12px] text-[#0b1c30] placeholder:text-[#94a3b8] outline-none"
              />
              {searchInput && (
                <button
                  onClick={() => setSearchInput("")}
                  className="text-[11px] text-[#64748b] hover:text-[#0b1c30] cursor-pointer ml-1"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono text-[12px] text-[#64748b]">
              {commits.length}
              {hasMore ? "+" : ""} commits
            </span>
            <button
              title="Refresh history"
              onClick={() => setDebouncedSearch((s) => s)}
              className="p-1 rounded hover:bg-[#e2e8f0] text-[#64748b] cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Table Header */}
        <div className="h-7 px-3 bg-[#f1f5f9] border-b border-[#e2e8f0] flex items-center text-[11px] font-semibold uppercase tracking-wider text-[#64748b] shrink-0">
          <div style={{ width: graphColWidth }} className="shrink-0">
            Graph
          </div>
          <div className="flex-1 min-w-0 pl-2">Description & Refs</div>
          <div className="w-40 shrink-0">Author</div>
          <div
            style={{ width: "calc(228px + var(--ui-font-delta, 0px) * 12)" }}
            className="shrink-0"
          >
            Date
          </div>
          <div className="w-20 shrink-0 text-right">Commit</div>
        </div>

        {/* Virtualized Commit Rows */}
        <div
          ref={listRef}
          onScroll={handleListScroll}
          className="flex-1 overflow-y-auto relative"
        >
          {loading && commits.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-[#64748b]">
              Loading commit graph...
            </div>
          ) : commits.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-[#94a3b8]">
              No commits found
            </div>
          ) : (
            <div
              style={{
                height: commits.length * ROW_HEIGHT + (hasMore ? 36 : 0),
                position: "relative",
              }}
            >
              {commits.slice(startIdx, endIdx).map((commit, offset) => {
                const idx = startIdx + offset;
                const layout = graphRows[idx];
                const isSelected = commit.hash === selectedHash;
                const laneX = (l: number) => 12 + l * LANE_SPACING;

                return (
                  <div
                    key={commit.hash}
                    onClick={() => setSelectedHash(commit.hash)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setSelectedHash(commit.hash);
                      const menuW = 220;
                      const menuH = 220;
                      setCtxMenu({
                        x: Math.min(e.clientX, window.innerWidth - menuW - 8),
                        y: Math.min(e.clientY, window.innerHeight - menuH - 8),
                        commit,
                      });
                    }}
                    style={{
                      position: "absolute",
                      top: idx * ROW_HEIGHT,
                      left: 0,
                      right: 0,
                      height: ROW_HEIGHT,
                    }}
                    className={`px-3 flex items-center cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-[#f0f9ff] shadow-[inset_2px_0_0_#0284c7]"
                        : "hover:bg-[#f8fafc]"
                    }`}
                  >
                    {/* SVG DAG Cell */}
                    <div
                      style={{ width: graphColWidth }}
                      className="h-full shrink-0 flex items-center overflow-hidden"
                    >
                      {layout && (
                        <svg
                          width={graphColWidth}
                          height={ROW_HEIGHT}
                          className="block overflow-hidden"
                        >
                          {layout.edges.map((edge, ei) => {
                            const x1 = laneX(edge.fromLane);
                            const x2 = laneX(edge.toLane);
                            if (edge.direction === "pass") {
                              return (
                                <line
                                  key={ei}
                                  x1={x1}
                                  y1={0}
                                  x2={x1}
                                  y2={ROW_HEIGHT}
                                  stroke={edge.color}
                                  strokeWidth={1.75}
                                />
                              );
                            }
                            if (edge.direction === "in") {
                              if (x1 === x2) {
                                return (
                                  <line
                                    key={ei}
                                    x1={x1}
                                    y1={0}
                                    x2={x2}
                                    y2={ROW_HEIGHT / 2}
                                    stroke={edge.color}
                                    strokeWidth={1.75}
                                  />
                                );
                              }
                              return (
                                <path
                                  key={ei}
                                  d={`M ${x1} 0 C ${x1} ${ROW_HEIGHT * 0.35}, ${x2} ${ROW_HEIGHT * 0.2}, ${x2} ${ROW_HEIGHT / 2}`}
                                  fill="none"
                                  stroke={edge.color}
                                  strokeWidth={1.75}
                                />
                              );
                            }
                            if (x1 === x2) {
                              return (
                                <line
                                  key={ei}
                                  x1={x1}
                                  y1={ROW_HEIGHT / 2}
                                  x2={x2}
                                  y2={ROW_HEIGHT}
                                  stroke={edge.color}
                                  strokeWidth={1.75}
                                />
                              );
                            }
                            return (
                              <path
                                key={ei}
                                d={`M ${x1} ${ROW_HEIGHT / 2} C ${x1} ${ROW_HEIGHT * 0.8}, ${x2} ${ROW_HEIGHT * 0.65}, ${x2} ${ROW_HEIGHT}`}
                                fill="none"
                                stroke={edge.color}
                                strokeWidth={1.75}
                              />
                            );
                          })}
                          {(() => {
                            const cx = laneX(layout.lane);
                            const cy = ROW_HEIGHT / 2;
                            const isMerge = (commit.parents?.length ?? 0) >= 2;
                            const isHead = (commit.refs ?? []).some(
                              (r) => r.type === "head"
                            );
                            return (
                              <>
                                {isHead && (
                                  <circle
                                    cx={cx}
                                    cy={cy}
                                    r={7}
                                    fill="none"
                                    stroke={layout.color}
                                    strokeWidth={1.25}
                                    strokeOpacity={0.45}
                                  />
                                )}
                                {isMerge ? (
                                  <circle
                                    cx={cx}
                                    cy={cy}
                                    r={4.5}
                                    fill="#ffffff"
                                    stroke={layout.color}
                                    strokeWidth={2.25}
                                  />
                                ) : (
                                  <circle
                                    cx={cx}
                                    cy={cy}
                                    r={4.2}
                                    fill={layout.color}
                                    stroke="#ffffff"
                                    strokeWidth={1.5}
                                  />
                                )}
                              </>
                            );
                          })()}
                        </svg>
                      )}
                    </div>

                    {/* Subject & Ref Badges */}
                    <div className="flex-1 min-w-0 overflow-hidden pl-2 pr-3 flex items-center gap-1.5">
                      {(commit.refs ?? []).map((ref, ri) => (
                        <span
                          key={ri}
                          className={`px-1.5 py-0.5 rounded text-[11px] font-mono font-medium shrink-0 inline-flex items-center gap-1 ${
                            ref.type === "head"
                              ? "bg-[#0284c7] text-white font-semibold"
                              : ref.type === "local"
                              ? "bg-[#e0f2fe] text-[#0369a1] border border-[#bae6fd]"
                              : ref.type === "remote"
                              ? "bg-[#fff7ed] text-[#c2410c] border border-[#ffedd5]"
                              : "bg-[#f0fdf4] text-[#15803d] border border-[#bbf7d0]"
                          }`}
                        >
                          {ref.type === "tag" && <TagIcon className="w-3 h-3" />}
                          {ref.name}
                        </span>
                      ))}
                      <span
                        className={`text-[13px] truncate ${
                          isSelected
                            ? "font-semibold text-[#0b1c30]"
                            : "text-[#1e293b]"
                        }`}
                      >
                        {commit.subject}
                      </span>
                    </div>

                    {/* Author */}
                    <div className="w-40 shrink-0 flex items-center min-w-0 pr-2">
                      <span className="text-[12px] text-[#334155] truncate">
                        {commit.author}
                      </span>
                    </div>

                    {/* Full Date (YYYY-MM-DD HH:mm:ss) + Relative Time */}
                    <div
                      title={`${commit.dateFormatted} (${commit.relativeTime})`}
                      style={{ width: "calc(228px + var(--ui-font-delta, 0px) * 12)" }}
                      className="shrink-0 flex items-center gap-2 font-mono text-[12px] text-[#475569] pr-2 whitespace-nowrap"
                    >
                      <span className="shrink-0 whitespace-nowrap">
                        {commit.dateFormatted}
                      </span>
                      <span className="text-[11px] text-[#94a3b8] font-sans shrink-0 whitespace-nowrap">
                        {commit.relativeTime}
                      </span>
                    </div>

                    {/* Short SHA */}
                    <div className="w-20 shrink-0 text-right font-mono text-[12px] text-[#0284c7] font-medium">
                      {commit.shortHash}
                    </div>
                  </div>
                );
              })}

              {hasMore && (
                <div
                  style={{
                    position: "absolute",
                    top: commits.length * ROW_HEIGHT,
                    left: 0,
                    right: 0,
                    height: 36,
                  }}
                  className="flex items-center justify-center border-t border-[#f1f5f9]"
                >
                  <button
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="px-3 py-1 rounded text-[11px] font-medium text-[#0284c7] hover:bg-[#f0f9ff] cursor-pointer"
                  >
                    {loadingMore ? "Loading next 100..." : "Load 100 more commits"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <SplitHandle
        direction="vertical"
        variant="gap"
        title="Drag to resize Commit Graph / Detail · Double-click to reset"
        onDragStart={() => {
          const top = topPaneRef.current?.getBoundingClientRect().height ?? 0;
          const bot = bottomPaneRef.current?.getBoundingClientRect().height ?? 0;
          vDragRef.current = { startPx: bot, totalPx: Math.max(1, top + bot) };
        }}
        onDragMove={(_, dy) => {
          const { startPx, totalPx } = vDragRef.current;
          const minTop = 160;
          const minBottom = 200;
          const nextBot = clamp(
            startPx - dy,
            minBottom,
            Math.max(minBottom, totalPx - minTop)
          );
          const nextRatio = clamp(nextBot / totalPx, 0.2, 0.75);
          onChangeRatios({ historyBottomRatio: nextRatio }, false);
        }}
        onDragEnd={() => onChangeRatios({}, true)}
        onReset={() =>
          onChangeRatios(
            { historyBottomRatio: DEFAULT_LAYOUT.historyBottomRatio },
            true
          )
        }
      />

      {/* BOTTOM HALF: Commit Metadata + Changed/All Files + Diff/Snapshot */}
      <div
        ref={bottomPaneRef}
        style={{ height: `calc((100% - 8px) * ${bottomRatio})` }}
        className="min-h-[200px] min-w-0 flex shrink-0"
      >
        {/* Left: Metadata & Files */}
        <div
          ref={detailLeftRef}
          style={{ width: `calc((100% - 8px) * ${detailLeftRatio})` }}
          className="min-w-[240px] shrink-0 flex flex-col bg-white border border-[#e2e8f0] rounded-lg overflow-hidden"
        >
          {detailLoading ? (
            <div className="flex-1 flex items-center justify-center text-xs text-[#64748b]">
              Loading commit details...
            </div>
          ) : detail ? (
            <>
              {/* Commit / Changes / File Tree Tabs */}
              <div className="px-2 py-1.5 bg-[#f1f5f9] border-b border-[#e2e8f0] flex flex-col gap-1.5 shrink-0">
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setInspectTab("commit")}
                      className={`px-2.5 py-1 rounded text-[12px] font-medium cursor-pointer transition-colors ${
                        inspectTab === "commit"
                          ? "bg-white text-[#0284c7] shadow-sm font-semibold"
                          : "text-[#64748b] hover:text-[#0b1c30]"
                      }`}
                    >
                      Commit
                    </button>
                    <button
                      onClick={() => {
                        setInspectTab("changes");
                        setFileScope("changed");
                        const files = detail.files ?? [];
                        if (!selectedFile || !files.some((f) => f.path === selectedFile)) {
                          setSelectedFile(files.length > 0 ? files[0].path : null);
                        }
                      }}
                      className={`px-2.5 py-1 rounded text-[12px] font-medium cursor-pointer transition-colors ${
                        inspectTab === "changes"
                          ? "bg-white text-[#0284c7] shadow-sm font-semibold"
                          : "text-[#64748b] hover:text-[#0b1c30]"
                      }`}
                    >
                      Changes ({(detail.files ?? []).length})
                    </button>
                    <button
                      onClick={() => {
                        setInspectTab("all");
                        setFileScope("all");
                        if (
                          !selectedFile ||
                          !treeEntries.some((t) => t.path === selectedFile)
                        ) {
                          setSelectedFile(
                            treeEntries.length > 0 ? treeEntries[0].path : null
                          );
                        }
                      }}
                      className={`px-2.5 py-1 rounded text-[12px] font-medium cursor-pointer transition-colors ${
                        inspectTab === "all"
                          ? "bg-white text-[#0284c7] shadow-sm font-semibold"
                          : "text-[#64748b] hover:text-[#0b1c30]"
                      }`}
                    >
                      File Tree ({treeLoading ? "..." : treeEntries.length})
                    </button>
                  </div>
                </div>

                {inspectTab !== "commit" && (
                  <div className="flex items-center bg-white border border-[#e2e8f0] focus-within:border-[#0284c7] rounded px-2 py-0.5">
                    <Search className="w-3.5 h-3.5 text-[#94a3b8] mr-1.5 shrink-0" />
                    <input
                      type="text"
                      value={fileFilter}
                      onChange={(e) => setFileFilter(e.target.value)}
                      placeholder={
                        inspectTab === "changes"
                          ? "Filter changed files..."
                          : "Filter files in tree..."
                      }
                      className="w-full bg-transparent text-[12px] outline-none placeholder:text-[#94a3b8]"
                    />
                  </div>
                )}
              </div>

              {inspectTab === "commit" ? (
                <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 bg-white">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[14px] font-semibold text-[#0b1c30] leading-snug select-text">
                      {detail.subject}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => onCreateBranchFromCommit(detail.hash)}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-[#f8fafc] border border-[#e2e8f0] hover:border-[#0284c7] text-[12px] font-medium text-[#0284c7] cursor-pointer"
                      >
                        <GitBranch className="w-3.5 h-3.5" />
                        Branch
                      </button>
                      <button
                        onClick={() => onCreateTagFromCommit(detail.hash)}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-[#f8fafc] border border-[#e2e8f0] hover:border-[#16a34a] text-[12px] font-medium text-[#15803d] cursor-pointer"
                      >
                        <TagIcon className="w-3.5 h-3.5" />
                        Tag
                      </button>
                      <button
                        onClick={() => onCreateWorktreeFromCommit(detail.hash)}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-[#f8fafc] border border-[#e2e8f0] hover:border-[#0f766e] text-[12px] font-medium text-[#0f766e] cursor-pointer"
                      >
                        <FolderTree className="w-3.5 h-3.5" />
                        Worktree
                      </button>
                    </div>
                  </div>

                  {detail.body && (
                    <pre className="text-[12px] font-mono text-[#334155] whitespace-pre-wrap bg-[#f8fafc] border border-[#e2e8f0] rounded-md p-2.5 leading-relaxed select-text">
                      {detail.body}
                    </pre>
                  )}

                  <div className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-2.5 flex flex-col gap-2 text-[12px]">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-[#0b1c30] truncate">
                          {detail.author}
                        </div>
                        <div className="text-[11px] text-[#64748b] truncate">
                          {detail.email}
                        </div>
                      </div>
                      <span className="text-[#475569] font-mono text-[11px] shrink-0">
                        {detail.dateFormatted}
                      </span>
                    </div>

                    <div className="h-px bg-[#e2e8f0]" />

                    <div className="flex flex-col gap-1.5 font-mono text-[12px] text-[#475569]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#64748b]">Commit</span>
                        <span className="inline-flex items-center gap-1.5 text-[#0b1c30] truncate">
                          <span className="truncate">{detail.hash}</span>
                          <button
                            title="Copy full SHA"
                            onClick={() => {
                              navigator.clipboard.writeText(detail.hash);
                              onNotify("info", `Copied ${detail.shortHash}`);
                            }}
                            className="p-0.5 rounded hover:bg-[#e2e8f0] text-[#64748b] hover:text-[#0284c7] cursor-pointer shrink-0"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      </div>
                      {(detail.parents ?? []).length > 0 && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[#64748b]">Parent</span>
                          <span className="truncate text-[#334155]">
                            {(detail.parents ?? [])
                              .map((p) => p.slice(0, 7))
                              .join(", ")}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setInspectTab("changes");
                      setFileScope("changed");
                    }}
                    className="self-start flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#f0f9ff] border border-[#bae6fd] text-[12px] font-medium text-[#0284c7] hover:bg-[#e0f2fe] cursor-pointer transition-colors"
                  >
                    <GitCommitHorizontal className="w-3.5 h-3.5" />
                    <span>
                      View {(detail.files ?? []).length} changed file(s)
                    </span>
                  </button>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto p-1 flex flex-col gap-0.5">
                  {inspectTab === "changes" ? (
                    filteredChangedFiles.length === 0 ? (
                      <div className="py-6 text-center text-[12px] text-[#94a3b8]">
                        No matching changed files
                      </div>
                    ) : (
                      filteredChangedFiles.map((f) => {
                        const active = f.path === selectedFile;
                        return (
                          <div
                            key={f.path}
                            onClick={() => setSelectedFile(f.path)}
                            className={`flex items-center justify-between px-2 py-1 rounded cursor-pointer transition-colors ${
                              active
                                ? "bg-[#f0f9ff] text-[#0b1c30] font-medium"
                                : "hover:bg-[#f8fafc] text-[#334155]"
                            }`}
                          >
                            <div className="flex items-center gap-1.5 min-w-0 pr-2">
                              <StatusBadge status={f.status} />
                              <span className="font-mono text-[12px] truncate">
                                {f.origPath ? `${f.origPath} → ${f.path}` : f.path}
                              </span>
                            </div>
                            <span className="font-mono text-[11px] shrink-0">
                              {f.isBinary ? (
                                <span className="text-[#64748b]">BIN</span>
                              ) : (
                                <>
                                  {f.additions > 0 && (
                                    <span className="text-[#16a34a] mr-1">
                                      +{f.additions}
                                    </span>
                                  )}
                                  {f.deletions > 0 && (
                                    <span className="text-[#dc2626]">
                                      -{f.deletions}
                                    </span>
                                  )}
                                </>
                              )}
                            </span>
                          </div>
                        );
                      })
                    )
                  ) : treeLoading ? (
                    <div className="py-6 text-center text-[12px] text-[#64748b]">
                      Loading file tree...
                    </div>
                  ) : filteredTreeEntries.length === 0 ? (
                    <div className="py-6 text-center text-[12px] text-[#94a3b8]">
                      No files at this commit
                    </div>
                  ) : (
                    renderTreeNodes(allTree, 0)
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-[#94a3b8]">
              Select a commit to view details
            </div>
          )}
        </div>

        <SplitHandle
          direction="horizontal"
          variant="gap"
          title="Drag to resize File List / File Detail · Double-click to reset"
          onDragStart={() => {
            const l = detailLeftRef.current?.getBoundingClientRect().width ?? 0;
            const r = detailRightRef.current?.getBoundingClientRect().width ?? 0;
            hDragRef.current = { startPx: l, totalPx: Math.max(1, l + r) };
          }}
          onDragMove={(dx) => {
            const { startPx, totalPx } = hDragRef.current;
            const minLeft = 240;
            const minRight = 280;
            const nextLeft = clamp(
              startPx + dx,
              minLeft,
              Math.max(minLeft, totalPx - minRight)
            );
            const nextRatio = clamp(nextLeft / totalPx, 0.2, 0.75);
            onChangeRatios({ historyDetailLeftRatio: nextRatio }, false);
          }}
          onDragEnd={() => onChangeRatios({}, true)}
          onReset={() =>
            onChangeRatios(
              { historyDetailLeftRatio: DEFAULT_LAYOUT.historyDetailLeftRatio },
              true
            )
          }
        />

        {/* Right: Commit File Diff OR Snapshot File Viewer */}
        <div
          ref={detailRightRef}
          className="flex-1 flex flex-col min-w-0 min-h-0 bg-white border border-[#e2e8f0] rounded-lg overflow-hidden"
        >
          <div className="h-9 px-3 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-[12px] font-semibold text-[#0b1c30] truncate">
                {selectedFile ||
                  (fileScope === "changed" ? "File Diff" : "File Snapshot")}
              </span>
              {fileScope === "all" && snapshotContent && (
                <span className="px-1.5 py-0.5 rounded bg-[#f1f5f9] font-mono text-[11px] text-[#475569] shrink-0">
                  {formatBytes(snapshotContent.size)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {selectedFile && (
                <button
                  onClick={() => GitService.OpenInEditor(repo.path, selectedFile)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-[#e2e8f0] text-[11px] text-[#334155] hover:border-[#cbd5e1] cursor-pointer"
                >
                  <ExternalLink className="w-3 h-3" />
                  Open
                </button>
              )}
              {fileScope === "changed" ? (
                <>
                  <label className="flex items-center gap-1 text-[11px] text-[#475569] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ignoreWs}
                      onChange={(e) => setIgnoreWs(e.target.checked)}
                      className="w-3 h-3 accent-[#0284c7]"
                    />
                    No WS
                  </label>
                  <div className="flex items-center bg-white border border-[#e2e8f0] rounded p-0.5">
                    <button
                      onClick={() => setDiffMode("unified")}
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] cursor-pointer ${
                        diffMode === "unified"
                          ? "bg-[#f0f9ff] text-[#0284c7] font-medium"
                          : "text-[#64748b]"
                      }`}
                    >
                      <AlignJustify className="w-3 h-3" />
                      Unified
                    </button>
                    <button
                      onClick={() => setDiffMode("split")}
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] cursor-pointer ${
                        diffMode === "split"
                          ? "bg-[#f0f9ff] text-[#0284c7] font-medium"
                          : "text-[#64748b]"
                      }`}
                    >
                      <Columns2 className="w-3 h-3" />
                      Split
                    </button>
                  </div>
                </>
              ) : (
                snapshotContent &&
                !snapshotContent.isBinary &&
                snapshotContent.content && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(snapshotContent.content);
                      onNotify("info", `Copied ${snapshotContent.path}`);
                    }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-[#e2e8f0] text-[11px] text-[#334155] hover:border-[#cbd5e1] cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    Copy File
                  </button>
                )
              )}
            </div>
          </div>

          {fileScope === "changed" ? (
            <DiffViewer
              diff={fileDiff}
              loading={diffLoading}
              mode={diffMode}
              emptyMessage="Select a changed file to inspect its commit diff"
            />
          ) : snapshotLoading ? (
            <div className="flex-1 flex items-center justify-center text-xs text-[#64748b]">
              Loading file snapshot...
            </div>
          ) : !snapshotContent ? (
            <div className="flex-1 flex items-center justify-center text-xs text-[#94a3b8]">
              Select a file from the commit tree to inspect its contents
            </div>
          ) : snapshotContent.rawError ? (
            <div className="flex-1 flex items-center justify-center text-xs text-[#dc2626] p-4">
              {snapshotContent.rawError}
            </div>
          ) : snapshotContent.isBinary ? (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-5 text-center">
                <FileArchive className="w-8 h-8 text-[#0284c7] mx-auto mb-2" />
                <div className="text-xs font-semibold text-[#0b1c30]">
                  Binary File ({formatBytes(snapshotContent.size)})
                </div>
                <div className="font-mono text-[11px] text-[#64748b] mt-1">
                  {snapshotContent.path}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 min-w-0 min-h-0 overflow-auto bg-white font-mono text-[12px] leading-[20px]">
              {snapshotContent.truncated && (
                <div className="px-3 py-1 bg-[#fffbeb] border-b border-[#fde68a] text-[11px] text-[#b45309]">
                  Preview truncated to 512 KB (total size:{" "}
                  {formatBytes(snapshotContent.size)}).
                </div>
              )}
              <div className="w-max min-w-full">
                <table className="w-full border-collapse">
                  <tbody>
                    {snapshotContent.content.split("\n").map((line, i) => (
                      <tr key={i} className="hover:bg-[#f8fafc]">
                        <td className="w-12 min-w-[48px] px-2 text-right select-none text-[11px] text-[#94a3b8] bg-[#f8fafc] border-r border-[#e2e8f0]">
                          {i + 1}
                        </td>
                        <td className="px-3 pr-6 whitespace-pre select-text text-[#0b1c30]">
                          {line}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* COMMIT CONTEXT MENU */}
      {ctxMenu && (
        <div
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-60 bg-white border border-[#cbd5e1] rounded-lg shadow-xl py-1 text-[13px] text-[#0b1c30] select-none"
        >
          <div className="px-3 py-1 border-b border-[#f1f5f9] flex items-center justify-between text-[11px] font-mono text-[#64748b]">
            <span className="text-[#0284c7] font-semibold">
              {ctxMenu.commit.shortHash}
            </span>
            <span className="truncate ml-2">{ctxMenu.commit.dateFormatted}</span>
          </div>

          <button
            onClick={() => {
              const sha = ctxMenu.commit.hash;
              setCtxMenu(null);
              onCreateBranchFromCommit(sha);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0f9ff] hover:text-[#0284c7] cursor-pointer"
          >
            <GitBranch className="w-3.5 h-3.5 text-[#0284c7]" />
            <span>New Branch Here...</span>
          </button>

          <button
            onClick={() => {
              const sha = ctxMenu.commit.hash;
              setCtxMenu(null);
              onCreateTagFromCommit(sha);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0f9ff] hover:text-[#0284c7] cursor-pointer"
          >
            <TagIcon className="w-3.5 h-3.5 text-[#16a34a]" />
            <span>New Tag Here...</span>
          </button>

          <button
            onClick={() => {
              const sha = ctxMenu.commit.hash;
              setCtxMenu(null);
              onCreateWorktreeFromCommit(sha);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0fdfa] hover:text-[#0f766e] cursor-pointer"
          >
            <FolderTree className="w-3.5 h-3.5 text-[#0f766e]" />
            <span>New Worktree Here...</span>
          </button>

          <div className="my-1 border-t border-[#f1f5f9]" />

          <button
            onClick={() => {
              const c = ctxMenu.commit;
              setCtxMenu(null);
              onRequestRevertCommit(c);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0f9ff] hover:text-[#0284c7] cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[#0284c7]" />
            <span>Revert Commit...</span>
          </button>

          <button
            onClick={() => {
              const c = ctxMenu.commit;
              setCtxMenu(null);
              onRequestResetCommit(c);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-[#d97706] hover:bg-[#fffbeb] cursor-pointer"
          >
            <History className="w-3.5 h-3.5" />
            <span>Reset Branch to Here...</span>
          </button>

          <div className="my-1 border-t border-[#f1f5f9]" />

          <button
            onClick={() => {
              const c = ctxMenu.commit;
              setCtxMenu(null);
              navigator.clipboard.writeText(c.hash);
              onNotify("info", `Copied ${c.shortHash}`);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f8fafc] text-[#475569] cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy Full SHA</span>
          </button>
        </div>
      )}
    </div>
  );
};
