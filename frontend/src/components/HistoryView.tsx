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
  Tag as TagIcon,
  ExternalLink,
} from "lucide-react";
import type {
  BranchInfo,
  CommitDetail,
  CommitItem,
  FileDiff,
  RepoLocation,
} from "../../bindings/gitpulse/internal/git/models";
import { GitService } from "../../bindings/gitpulse";
import { computeCommitGraph } from "../utils/dag";
import { DiffViewer } from "./DiffViewer";
import { StatusBadge } from "./StatusBadge";

interface HistoryViewProps {
  repo: RepoLocation;
  branches: BranchInfo[];
  refreshKey: number;
  externalSearch?: string;
  onCreateBranchFromCommit: (sha: string) => void;
  onNotify: (type: "success" | "error" | "info", msg: string) => void;
}

const PAGE_SIZE = 100;
const ROW_HEIGHT = 28;
const LANE_SPACING = 14;

export const HistoryView: React.FC<HistoryViewProps> = ({
  repo,
  branches,
  refreshKey,
  externalSearch,
  onCreateBranchFromCommit,
  onNotify,
}) => {
  const [selectedBranch, setSelectedBranch] = useState<string>("__ALL__");
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
  const [ignoreWs, setIgnoreWs] = useState(false);

  // Virtual scroll state for commit list
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);

  useEffect(() => {
    if (externalSearch !== undefined && externalSearch !== searchInput) {
      setSearchInput(externalSearch);
    }
  }, [externalSearch]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 220);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset and load first page when repo, branch, search, or refreshKey changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    GitService.GetCommitHistory(
      repo.path,
      selectedBranch,
      debouncedSearch,
      0,
      PAGE_SIZE
    )
      .then((page) => {
        if (cancelled) return;
        const list = page.commits ?? [];
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
      setCommits((prev) => [...prev, ...(page.commits ?? [])]);
      setHasMore(page.hasMore);
    } catch (err) {
      onNotify("error", `Load more failed: ${err}`);
    } finally {
      setLoadingMore(false);
    }
  };

  // Load commit detail when selectedHash changes
  useEffect(() => {
    if (!selectedHash) {
      setDetail(null);
      setSelectedFile(null);
      setFileDiff(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    GitService.GetCommitDetail(repo.path, selectedHash)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        const files = d.files ?? [];
        setSelectedFile(files.length > 0 ? files[0].path : null);
      })
      .catch((err) => {
        if (!cancelled) onNotify("error", `Failed to load commit: ${err}`);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo.path, selectedHash]);

  // Load commit file diff
  useEffect(() => {
    if (!selectedHash || !selectedFile) {
      setFileDiff(null);
      return;
    }
    let cancelled = false;
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
    return () => {
      cancelled = true;
    };
  }, [repo.path, selectedHash, selectedFile, ignoreWs]);

  // Measure viewport for virtual window
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    ro.observe(el);
    setViewportHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const graphRows = useMemo(() => computeCommitGraph(commits), [commits]);
  const maxLanes = useMemo(() => {
    let m = 2;
    for (const r of graphRows) {
      if (r.maxLanes > m) m = r.maxLanes;
    }
    return Math.min(m, 8);
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

  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 p-2 gap-2 bg-[#f8fafc]">
      {/* TOP HALF: Filter Toolbar + Commit DAG List */}
      <div className="flex-1 flex flex-col min-h-0 bg-white border border-[#e2e8f0] rounded-lg overflow-hidden">
        {/* Filter bar */}
        <div className="h-9 px-3 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="relative flex items-center">
              <GitBranch className="w-3.5 h-3.5 text-[#0284c7] absolute left-2 pointer-events-none" />
              <select
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
                className="h-6 pl-7 pr-6 rounded bg-white border border-[#e2e8f0] text-[11px] font-medium text-[#0b1c30] outline-none focus:border-[#0284c7] appearance-none cursor-pointer"
              >
                <option value="__ALL__">All Branches ({branches.length})</option>
                {branches.map((b) => (
                  <option key={b.fullName} value={b.name}>
                    {b.isCurrent ? `● ${b.name}` : b.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 text-[#64748b] absolute right-1.5 pointer-events-none" />
            </div>

            <div className="flex items-center flex-1 max-w-md h-6 bg-white border border-[#e2e8f0] focus-within:border-[#0284c7] rounded px-2">
              <Search className="w-3.5 h-3.5 text-[#94a3b8] mr-1.5 shrink-0" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search commit message, author, or hash..."
                className="w-full bg-transparent text-[11px] text-[#0b1c30] placeholder:text-[#94a3b8] outline-none"
              />
              {searchInput && (
                <button
                  onClick={() => setSearchInput("")}
                  className="text-[10px] text-[#64748b] hover:text-[#0b1c30] cursor-pointer ml-1"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono text-[11px] text-[#64748b]">
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
        <div className="h-6 px-3 bg-[#f1f5f9] border-b border-[#e2e8f0] flex items-center text-[10px] font-semibold uppercase tracking-wider text-[#64748b] shrink-0">
          <div style={{ width: graphColWidth }} className="shrink-0">
            Graph
          </div>
          <div className="flex-1 min-w-0 pl-2">Description & Refs</div>
          <div className="w-40 shrink-0">Author</div>
          <div className="w-32 shrink-0">Date</div>
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
                      className="h-full shrink-0 flex items-center"
                    >
                      {layout && (
                        <svg
                          width={graphColWidth}
                          height={ROW_HEIGHT}
                          className="overflow-visible block"
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
                            // outgoing edge
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
                          <circle
                            cx={laneX(layout.lane)}
                            cy={ROW_HEIGHT / 2}
                            r={4}
                            fill={layout.color}
                            stroke="#ffffff"
                            strokeWidth={1.5}
                          />
                        </svg>
                      )}
                    </div>

                    {/* Subject & Ref Badges */}
                    <div className="flex-1 min-w-0 pl-2 pr-3 flex items-center gap-1.5">
                      {(commit.refs ?? []).map((ref, ri) => (
                        <span
                          key={ri}
                          className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-medium shrink-0 inline-flex items-center gap-1 ${
                            ref.type === "head"
                              ? "bg-[#0284c7] text-white font-semibold"
                              : ref.type === "local"
                              ? "bg-[#e0f2fe] text-[#0369a1] border border-[#bae6fd]"
                              : ref.type === "remote"
                              ? "bg-[#fff7ed] text-[#c2410c] border border-[#ffedd5]"
                              : "bg-[#f0fdf4] text-[#15803d] border border-[#bbf7d0]"
                          }`}
                        >
                          {ref.type === "tag" && <TagIcon className="w-2.5 h-2.5" />}
                          {ref.name}
                        </span>
                      ))}
                      <span
                        className={`text-[12px] truncate ${
                          isSelected
                            ? "font-semibold text-[#0b1c30]"
                            : "text-[#1e293b]"
                        }`}
                      >
                        {commit.subject}
                      </span>
                    </div>

                    {/* Author */}
                    <div className="w-40 shrink-0 flex items-center gap-1.5 min-w-0 pr-2">
                      <span className="w-4 h-4 rounded-full bg-[#e0f2fe] text-[#0369a1] text-[9px] font-bold flex items-center justify-center shrink-0">
                        {getInitials(commit.author || "?")}
                      </span>
                      <span className="text-[11px] text-[#334155] truncate">
                        {commit.author}
                      </span>
                    </div>

                    {/* Relative Time */}
                    <div
                      title={commit.dateFormatted}
                      className="w-32 shrink-0 text-[11px] text-[#64748b] truncate"
                    >
                      {commit.relativeTime}
                    </div>

                    {/* Short SHA */}
                    <div className="w-20 shrink-0 text-right font-mono text-[11px] text-[#0284c7] font-medium">
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

      {/* BOTTOM HALF: Commit Metadata + Changed Files + Diff */}
      <div className="h-[46%] min-h-[220px] flex gap-2 shrink-0">
        {/* Left: Metadata & Changed Files */}
        <div className="w-[42%] min-w-[340px] flex flex-col bg-white border border-[#e2e8f0] rounded-lg overflow-hidden">
          {detailLoading ? (
            <div className="flex-1 flex items-center justify-center text-xs text-[#64748b]">
              Loading commit details...
            </div>
          ) : detail ? (
            <>
              <div className="p-3 border-b border-[#e2e8f0] bg-[#f8fafc] flex flex-col gap-1.5 shrink-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[13px] font-semibold text-[#0b1c30] leading-snug">
                    {detail.subject}
                  </div>
                  <button
                    onClick={() => onCreateBranchFromCommit(detail.hash)}
                    className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-[#e2e8f0] hover:border-[#0284c7] text-[11px] font-medium text-[#0284c7] cursor-pointer"
                  >
                    <GitBranch className="w-3 h-3" />
                    Branch here
                  </button>
                </div>

                {detail.body && (
                  <pre className="text-[11px] font-mono text-[#475569] whitespace-pre-wrap bg-white border border-[#e2e8f0] rounded p-2 max-h-20 overflow-y-auto">
                    {detail.body}
                  </pre>
                )}

                <div className="flex items-center justify-between gap-2 text-[11px] text-[#475569] pt-0.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <GitCommitHorizontal className="w-3.5 h-3.5 text-[#0284c7] shrink-0" />
                    <span className="font-medium text-[#0b1c30] truncate">
                      {detail.author}
                    </span>
                    <span className="text-[#94a3b8] truncate">
                      &lt;{detail.email}&gt;
                    </span>
                  </div>
                  <span className="text-[#64748b] shrink-0" title={detail.dateFormatted}>
                    {detail.relativeTime}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-[11px] font-mono text-[#64748b]">
                  <span className="px-1.5 py-0.5 rounded bg-white border border-[#e2e8f0] text-[#0b1c30] inline-flex items-center gap-1">
                    SHA: {detail.shortHash}
                    <button
                      title="Copy full SHA"
                      onClick={() => {
                        navigator.clipboard.writeText(detail.hash);
                        onNotify("info", `Copied ${detail.shortHash}`);
                      }}
                      className="text-[#64748b] hover:text-[#0284c7] cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </span>
                  {(detail.parents ?? []).length > 0 && (
                    <span className="truncate">
                      Parent:{" "}
                      {(detail.parents ?? [])
                        .map((p) => p.slice(0, 7))
                        .join(", ")}
                    </span>
                  )}
                </div>
              </div>

              {/* Changed files header */}
              <div className="h-7 px-3 bg-[#f1f5f9] border-b border-[#e2e8f0] flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-[#64748b] shrink-0">
                <span>Changed Files ({(detail.files ?? []).length})</span>
              </div>

              <div className="flex-1 overflow-y-auto p-1 flex flex-col gap-0.5">
                {(detail.files ?? []).map((f) => {
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
                        <span className="font-mono text-[11px] truncate">
                          {f.origPath ? `${f.origPath} → ${f.path}` : f.path}
                        </span>
                      </div>
                      <span className="font-mono text-[10px] shrink-0">
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
                })}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-[#94a3b8]">
              Select a commit to view details
            </div>
          )}
        </div>

        {/* Right: Commit File Diff */}
        <div className="flex-1 flex flex-col min-w-0 bg-white border border-[#e2e8f0] rounded-lg overflow-hidden">
          <div className="h-9 px-3 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between gap-2 shrink-0">
            <span className="font-mono text-[11px] font-semibold text-[#0b1c30] truncate">
              {selectedFile || "File Diff"}
            </span>
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
            </div>
          </div>
          <DiffViewer
            diff={fileDiff}
            loading={diffLoading}
            mode={diffMode}
            emptyMessage="Select a changed file to inspect its commit diff"
          />
        </div>
      </div>
    </div>
  );
};
