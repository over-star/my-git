import React, { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Cloud,
  Folder,
  FolderOpen,
  GitBranch,
  GitMerge,
  Trash2,
  Plus,
  Archive,
  Play,
  ArrowUpFromLine,
  Tag as TagIcon,
  Pencil,
  CloudOff,
  CheckCircle2,
  Check,
  Copy,
  History,
  UploadCloud,
  Pin,
  PinOff,
  FolderTree,
  Lock,
  Unlock,
  AlertTriangle,
  Terminal,
  ExternalLink,
  Eraser,
} from "lucide-react";
import type {
  BranchInfo,
  RemoteInfo,
  StashItem,
  TagInfo,
  WorktreeInfo,
} from "../../bindings/gitpulse/internal/git/models";

interface SidebarProps {
  width?: number;
  branches: BranchInfo[];
  tags: TagInfo[];
  stashes: StashItem[];
  remotes: RemoteInfo[];
  worktrees: WorktreeInfo[];
  openTabPaths: string[];
  pinnedBranches: string[];
  currentBranch: string;
  activeHistoryBranch: string;
  branchScopeMode: "branch" | "all";
  onChangeBranchScopeMode: (mode: "branch" | "all") => void;
  onInspectBranch: (
    refName: string,
    focusSha?: string,
    forceScope?: "branch" | "all"
  ) => void;
  onTogglePinBranch: (fullName: string) => void;
  onCheckout: (name: string, isRemote: boolean) => void;
  onMerge: (name: string) => void;
  onRequestDeleteBranch: (name: string) => void;
  onRequestDeleteRemoteBranch: (remoteBranch: string) => void;
  onRequestRenameBranch: (name: string) => void;
  onRequestCreateBranch: (startPoint?: string, checkout?: boolean) => void;
  onRequestCreateTag: (target?: string) => void;
  onCheckoutTag: (tagName: string) => void;
  onPushTag: (tag: TagInfo) => void;
  onRequestDeleteTag: (tag: TagInfo) => void;
  onRequestDeleteRemoteTag: (tag: TagInfo) => void;
  onRequestStashPush: () => void;
  onStashApply: (ref: string) => void;
  onStashPop: (ref: string) => void;
  onStashDrop: (stash: StashItem) => void;
  onOpenWorktree: (wt: WorktreeInfo) => void;
  onRequestCreateWorktree: (opts?: {
    mode?: "new-branch" | "existing-branch" | "detach";
    branch?: string;
    baseRef?: string;
  }) => void;
  onRequestRemoveWorktree: (wt: WorktreeInfo) => void;
  onRequestLockWorktree: (wt: WorktreeInfo) => void;
  onUnlockWorktree: (wt: WorktreeInfo) => void;
  onPruneWorktrees: () => void;
  onOpenWorktreeInExplorer: (wt: WorktreeInfo) => void;
  onOpenWorktreeInTerminal: (wt: WorktreeInfo) => void;
  onNotify: (type: "success" | "error" | "info", msg: string) => void;
}

type ContextMenuState =
  | { kind: "branch"; x: number; y: number; branch: BranchInfo }
  | { kind: "tag"; x: number; y: number; tag: TagInfo }
  | { kind: "stash"; x: number; y: number; stash: StashItem }
  | { kind: "worktree"; x: number; y: number; worktree: WorktreeInfo };

interface BranchTreeNode {
  name: string;
  path: string;
  children: BranchTreeNode[];
  branch?: BranchInfo;
  count: number;
  hasCurrent: boolean;
}

function buildBranchTree(items: BranchInfo[]): BranchTreeNode[] {
  const root: BranchTreeNode = {
    name: "",
    path: "",
    children: [],
    count: 0,
    hasCurrent: false,
  };

  for (const branch of items) {
    const parts = branch.name.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let cur = root;
    cur.count++;
    if (branch.isCurrent) cur.hasCurrent = true;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const nodePath = parts.slice(0, i + 1).join("/");
      let next = cur.children.find(
        (c) => c.name === part && (isLast ? !!c.branch : !c.branch)
      );
      if (!next) {
        next = {
          name: part,
          path: nodePath,
          children: [],
          branch: isLast ? branch : undefined,
          count: isLast ? 1 : 0,
          hasCurrent: branch.isCurrent,
        };
        cur.children.push(next);
      } else {
        if (!isLast) next.count++;
        if (branch.isCurrent) next.hasCurrent = true;
      }
      cur = next;
    }
  }

  const sortNodes = (nodes: BranchTreeNode[]) => {
    nodes.sort((a, b) => {
      const aDir = !a.branch;
      const bDir = !b.branch;
      if (aDir !== bDir) return aDir ? -1 : 1;
      if (!aDir && !bDir && a.branch!.isCurrent !== b.branch!.isCurrent) {
        return a.branch!.isCurrent ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.children.length > 0) sortNodes(n.children);
    }
  };
  sortNodes(root.children);
  return root.children;
}

export const Sidebar: React.FC<SidebarProps> = ({
  width = 296,
  branches,
  tags,
  stashes,
  remotes,
  worktrees,
  openTabPaths,
  pinnedBranches,
  currentBranch,
  activeHistoryBranch,
  branchScopeMode,
  onChangeBranchScopeMode,
  onInspectBranch,
  onTogglePinBranch,
  onCheckout,
  onMerge,
  onRequestDeleteBranch,
  onRequestDeleteRemoteBranch,
  onRequestRenameBranch,
  onRequestCreateBranch,
  onRequestCreateTag,
  onCheckoutTag,
  onPushTag,
  onRequestDeleteTag,
  onRequestDeleteRemoteTag,
  onRequestStashPush,
  onStashApply,
  onStashPop,
  onStashDrop,
  onOpenWorktree,
  onRequestCreateWorktree,
  onRequestRemoveWorktree,
  onRequestLockWorktree,
  onUnlockWorktree,
  onPruneWorktrees,
  onOpenWorktreeInExplorer,
  onOpenWorktreeInTerminal,
  onNotify,
}) => {
  const [openWorktrees, setOpenWorktrees] = useState(true);
  const [openLocal, setOpenLocal] = useState(true);
  const [openRemotes, setOpenRemotes] = useState(true);
  const [openTags, setOpenTags] = useState(false);
  const [showAllTags, setShowAllTags] = useState(false);
  const [openStashes, setOpenStashes] = useState(false);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [copiedBranchKey, setCopiedBranchKey] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [folderOpenOverrides, setFolderOpenOverrides] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    if (activeHistoryBranch && activeHistoryBranch !== "__ALL__") {
      setSelectedRef((prev) => {
        if (prev && prev.endsWith(`:${activeHistoryBranch}`)) {
          return prev;
        }
        if (activeHistoryBranch.startsWith("refs/tags/")) {
          return `tag:${activeHistoryBranch.slice("refs/tags/".length)}`;
        }
        const match = branches.find((b) => b.fullName === activeHistoryBranch);
        if (match) {
          return `${match.isRemote ? "remote" : "local"}:${match.fullName}`;
        }
        return prev;
      });
    }
  }, [activeHistoryBranch, branches]);

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

  const clampMenuPos = (e: React.MouseEvent, menuHeight: number) => {
    const menuWidth = 240;
    return {
      x: Math.min(e.clientX, window.innerWidth - menuWidth - 8),
      y: Math.min(e.clientY, window.innerHeight - menuHeight - 8),
    };
  };

  const openBranchContextMenu = (
    e: React.MouseEvent,
    branch: BranchInfo,
    keyPrefix: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedRef(`${keyPrefix}:${branch.fullName}`);
    const { x, y } = clampMenuPos(e, 310);
    setCtxMenu({ kind: "branch", x, y, branch });
  };

  const openTagContextMenu = (e: React.MouseEvent, tag: TagInfo) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedRef(`tag:${tag.name}`);
    const { x, y } = clampMenuPos(e, 320);
    setCtxMenu({ kind: "tag", x, y, tag });
  };

  const openStashContextMenu = (e: React.MouseEvent, stash: StashItem) => {
    e.preventDefault();
    e.stopPropagation();
    const { x, y } = clampMenuPos(e, 180);
    setCtxMenu({ kind: "stash", x, y, stash });
  };

  const openWorktreeContextMenu = (
    e: React.MouseEvent,
    wt: WorktreeInfo
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const { x, y } = clampMenuPos(e, 270);
    setCtxMenu({ kind: "worktree", x, y, worktree: wt });
  };

  const selectedBranch = ctxMenu?.kind === "branch" ? ctxMenu.branch : null;
  const selectedTag = ctxMenu?.kind === "tag" ? ctxMenu.tag : null;
  const selectedStash = ctxMenu?.kind === "stash" ? ctxMenu.stash : null;
  const selectedWorktree =
    ctxMenu?.kind === "worktree" ? ctxMenu.worktree : null;

  const worktreeByBranch = useMemo(() => {
    const map = new Map<string, WorktreeInfo>();
    for (const wt of worktrees) {
      if (wt.branch) {
        map.set(wt.branch, wt);
      }
    }
    return map;
  }, [worktrees]);

  const openTabPathSet = useMemo(
    () => new Set(openTabPaths.map((p) => p.toLowerCase())),
    [openTabPaths]
  );

  const hasPrunableWorktree = useMemo(
    () => worktrees.some((wt) => wt.isPrunable),
    [worktrees]
  );

  const selectedBranchHolder =
    selectedBranch && !selectedBranch.isRemote
      ? worktreeByBranch.get(selectedBranch.name)
      : undefined;
  const selectedBranchInOtherWorktree =
    selectedBranchHolder && !selectedBranchHolder.isCurrent
      ? selectedBranchHolder
      : undefined;

  const isMainBranchName = (name: string, isRemote: boolean) => {
    if (!isRemote) return name === "main";
    const slashIdx = name.indexOf("/");
    const short = slashIdx >= 0 ? name.slice(slashIdx + 1) : name;
    return short === "main";
  };

  const canDeleteLocalBranch =
    !!selectedBranch &&
    !selectedBranch.isRemote &&
    !selectedBranch.isCurrent &&
    !selectedBranchInOtherWorktree &&
    !isMainBranchName(selectedBranch.name, false);
  const canDeleteRemoteBranch =
    !!selectedBranch &&
    selectedBranch.isRemote &&
    !isMainBranchName(selectedBranch.name, true);
  const canDeleteUpstreamBranch =
    !!selectedBranch &&
    !selectedBranch.isRemote &&
    Boolean(selectedBranch.upstream) &&
    !isMainBranchName(selectedBranch.upstream, true);

  const pinnedSet = useMemo(() => new Set(pinnedBranches), [pinnedBranches]);
  const branchByFullName = useMemo(
    () => new Map(branches.map((b) => [b.fullName, b])),
    [branches]
  );
  const pinnedBranchItems = useMemo(
    () =>
      pinnedBranches
        .map((fn) => branchByFullName.get(fn))
        .filter((b): b is BranchInfo => Boolean(b)),
    [pinnedBranches, branchByFullName]
  );
  const pinnedLocalBranches = useMemo(
    () => pinnedBranchItems.filter((b) => !b.isRemote),
    [pinnedBranchItems]
  );
  const pinnedRemoteBranches = useMemo(
    () => pinnedBranchItems.filter((b) => b.isRemote),
    [pinnedBranchItems]
  );
  const localBranches = useMemo(
    () =>
      branches
        .filter((b) => !b.isRemote)
        .sort((a, b) => (a.isCurrent === b.isCurrent ? 0 : a.isCurrent ? -1 : 1)),
    [branches]
  );
  const remoteBranches = useMemo(
    () => branches.filter((b) => b.isRemote),
    [branches]
  );
  const unpinnedLocalBranches = useMemo(
    () => localBranches.filter((b) => !pinnedSet.has(b.fullName)),
    [localBranches, pinnedSet]
  );
  const unpinnedRemoteBranches = useMemo(
    () => remoteBranches.filter((b) => !pinnedSet.has(b.fullName)),
    [remoteBranches, pinnedSet]
  );
  const localTree = useMemo(
    () => buildBranchTree(unpinnedLocalBranches),
    [unpinnedLocalBranches]
  );
  const remoteTree = useMemo(
    () => buildBranchTree(unpinnedRemoteBranches),
    [unpinnedRemoteBranches]
  );
  const hasLocalFolders = useMemo(
    () => localTree.some((n) => !n.branch),
    [localTree]
  );
  const hasRemoteFolders = useMemo(
    () => remoteTree.some((n) => !n.branch),
    [remoteTree]
  );

  const folderContainsRef = (
    node: BranchTreeNode,
    section: "local" | "remote"
  ): boolean => {
    if (node.branch) {
      const rowKey = `${section}:${node.branch.fullName}`;
      return (
        selectedRef === rowKey ||
        (activeHistoryBranch !== "" &&
          activeHistoryBranch !== "__ALL__" &&
          activeHistoryBranch === node.branch.fullName)
      );
    }
    return node.children.some((c) => folderContainsRef(c, section));
  };

  const isFolderOpen = (
    section: "local" | "remote",
    node: BranchTreeNode,
    depth: number
  ) => {
    const key = `${section}:${node.path}`;
    if (key in folderOpenOverrides) return folderOpenOverrides[key];
    if (node.hasCurrent || folderContainsRef(node, section)) return true;
    // Expand the single top-level remote folder (e.g. origin) by default, keep '/' subfolders collapsed
    if (section === "remote" && depth === 0 && remoteTree.length <= 1) {
      return true;
    }
    return false;
  };

  const toggleFolder = (
    section: "local" | "remote",
    nodePath: string,
    currentlyOpen: boolean
  ) => {
    const key = `${section}:${nodePath}`;
    setFolderOpenOverrides((prev) => ({ ...prev, [key]: !currentlyOpen }));
  };

  const renderBranchRow = (
    b: BranchInfo,
    keyPrefix: string,
    displayName = b.name,
    paddingLeft?: number
  ) => {
    const rowKey = `${keyPrefix}:${b.fullName}`;
    const isSelected = selectedRef === rowKey;
    const isPinned = pinnedSet.has(b.fullName);
    const holderWt = !b.isRemote ? worktreeByBranch.get(b.name) : undefined;
    const otherWt = holderWt && !holderWt.isCurrent ? holderWt : undefined;
    return (
      <div
        key={rowKey}
        onClick={() => {
          setSelectedRef(rowKey);
          onInspectBranch(b.fullName, b.lastSha);
        }}
        onDoubleClick={() => {
          if (otherWt) {
            onOpenWorktree(otherWt);
            return;
          }
          if (b.isRemote || !b.isCurrent) onCheckout(b.name, b.isRemote);
        }}
        onContextMenu={(e) => openBranchContextMenu(e, b, keyPrefix)}
        style={paddingLeft !== undefined ? { paddingLeft } : undefined}
        title={
          b.isCurrent
            ? `Current branch: ${b.name} · Click to view Commit Graph · Right-click for actions`
            : otherWt
            ? `Checked out in worktree "${otherWt.name}" (${otherWt.rawPath}) · Double-click to switch to worktree tab · Right-click for actions`
            : b.isRemote
            ? `Click to view Commit Graph · Double-click to checkout tracking branch for ${b.name} · Right-click for actions`
            : `Click to view Commit Graph · Double-click to checkout ${b.name} · Right-click for actions`
        }
        className={`group flex items-center justify-between ${
          paddingLeft !== undefined ? "pr-2" : "px-2"
        } py-1 rounded-md text-[13px] cursor-pointer transition-colors ${
          isSelected
            ? b.isCurrent
              ? "bg-[#0284c7] text-white font-bold shadow-xs"
              : "bg-[#0284c7] text-white font-semibold shadow-xs"
            : b.isCurrent
            ? "text-[#0b1c30] font-bold hover:bg-[#f1f5f9]"
            : b.isRemote
            ? "text-[#475569] hover:bg-[#f1f5f9] hover:text-[#0b1c30]"
            : "text-[#334155] hover:bg-[#f1f5f9] hover:text-[#0b1c30]"
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {b.isCurrent ? (
            <CheckCircle2
              className={`w-4 h-4 shrink-0 ${
                isSelected ? "text-white" : "text-[#0284c7]"
              }`}
            />
          ) : b.isRemote ? (
            <Cloud
              className={`w-4 h-4 shrink-0 ${
                isSelected ? "text-white/90" : "text-[#ea580c]/80"
              }`}
            />
          ) : (
            <GitBranch
              className={`w-4 h-4 shrink-0 ${
                isSelected ? "text-white/90" : "text-[#94a3b8]"
              }`}
            />
          )}
          <span className="truncate">{displayName}</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            title={`复制分支名: ${b.name}`}
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(b.name);
              setCopiedBranchKey(rowKey);
              onNotify("info", `已复制分支名: ${b.name}`);
              window.setTimeout(() => {
                setCopiedBranchKey((prev) => (prev === rowKey ? null : prev));
              }, 1200);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            className={`p-0.5 rounded cursor-pointer transition-colors ${
              copiedBranchKey === rowKey
                ? isSelected
                  ? "inline-flex text-white bg-white/20"
                  : "inline-flex text-[#16a34a] bg-[#dcfce7]"
                : isSelected
                ? "hidden group-hover:inline-flex text-white/85 hover:text-white hover:bg-white/20"
                : "hidden group-hover:inline-flex text-[#64748b] hover:text-[#0284c7] hover:bg-[#e2e8f0]"
            }`}
          >
            {copiedBranchKey === rowKey ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
          {b.ahead > 0 && (
            <span
              title={`${b.ahead} unpushed commit(s)`}
              className={`px-1.5 py-0.2 rounded-full font-mono text-[11px] font-semibold leading-tight ${
                isSelected
                  ? "bg-white/20 text-white"
                  : "bg-[#0284c7] text-white"
              }`}
            >
              ↑{b.ahead}
            </span>
          )}
          {b.behind > 0 && (
            <span
              title={`${b.behind} incoming commit(s) to pull`}
              className={`px-1.5 py-0.2 rounded-full font-mono text-[11px] font-semibold leading-tight ${
                isSelected
                  ? "bg-white/20 text-white"
                  : "bg-[#fef3c7] border border-[#fde68a] text-[#b45309]"
              }`}
            >
              ↓{b.behind}
            </span>
          )}
          <button
            type="button"
            title={isPinned ? "Unpin branch" : "Pin branch to top"}
            aria-label={isPinned ? "Unpin branch" : "Pin branch to top"}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePinBranch(b.fullName);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            className={`p-0.5 rounded cursor-pointer transition-colors ${
              isPinned
                ? isSelected
                  ? "inline-flex text-white hover:bg-white/20"
                  : "inline-flex text-[#d97706] hover:bg-[#fef3c7]"
                : isSelected
                ? "hidden group-hover:inline-flex text-white/85 hover:text-white hover:bg-white/20"
                : "hidden group-hover:inline-flex text-[#64748b] hover:text-[#d97706] hover:bg-[#fef3c7]"
            }`}
          >
            <Pin className={`w-3.5 h-3.5 ${isPinned ? "fill-current" : ""}`} />
          </button>
          {otherWt && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenWorktree(otherWt);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              title={`Checked out in worktree "${otherWt.name}" (${otherWt.rawPath}) · Click to open tab`}
              className={`px-1 py-[1px] rounded inline-flex items-center gap-0.5 text-[10px] font-mono font-semibold cursor-pointer ${
                isSelected
                  ? "bg-white/20 text-white hover:bg-white/30"
                  : "bg-[#f0fdfa] border border-[#99f6e4] text-[#0f766e] hover:bg-[#ccfbf1]"
              }`}
            >
              <FolderTree className="w-3 h-3" />
              <span className="max-w-[56px] truncate">{otherWt.name}</span>
            </button>
          )}
          {b.isCurrent && (
            <span
              className={`px-1.5 py-[1px] rounded text-[10px] font-mono font-bold tracking-wide ${
                isSelected
                  ? "bg-white/20 text-white"
                  : "bg-[#e0f2fe] text-[#0369a1]"
              }`}
            >
              HEAD
            </span>
          )}
        </div>
      </div>
    );
  };

  const renderBranchTree = (
    nodes: BranchTreeNode[],
    section: "local" | "remote",
    hasTopFolders: boolean,
    depth = 0
  ): React.ReactNode => {
    return nodes.map((node) => {
      if (node.branch) {
        const padLeft =
          depth === 0 && !hasTopFolders ? 8 : 20 + depth * 12;
        return renderBranchRow(node.branch, section, node.name, padLeft);
      }

      const open = isFolderOpen(section, node, depth);
      const isRemoteRoot = section === "remote" && depth === 0;
      return (
        <div key={`folder:${section}:${node.path}`} className="flex flex-col gap-0.5">
          <div
            onClick={() => toggleFolder(section, node.path, open)}
            style={{ paddingLeft: 4 + depth * 12 }}
            title={`${node.path}/ (${node.count})`}
            className="flex items-center justify-between pr-2 py-1 rounded-md text-[13px] text-[#334155] hover:bg-[#f1f5f9] hover:text-[#0b1c30] cursor-pointer transition-colors"
          >
            <div className="flex items-center gap-1 min-w-0 flex-1">
              {open ? (
                <ChevronDown className="w-3.5 h-3.5 text-[#94a3b8] shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-[#94a3b8] shrink-0" />
              )}
              {isRemoteRoot ? (
                <Cloud className="w-3.5 h-3.5 text-[#ea580c]/85 shrink-0" />
              ) : open ? (
                <FolderOpen className="w-3.5 h-3.5 text-[#0284c7] shrink-0" />
              ) : (
                <Folder className="w-3.5 h-3.5 text-[#64748b] shrink-0" />
              )}
              <span
                className={`truncate ${
                  node.hasCurrent ? "font-semibold text-[#0b1c30]" : ""
                }`}
              >
                {node.name}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {!open && node.hasCurrent && (
                <span className="px-1.5 py-[1px] rounded text-[10px] font-mono font-bold tracking-wide bg-[#e0f2fe] text-[#0369a1]">
                  HEAD
                </span>
              )}
              <span className="font-mono text-[11px] text-[#94a3b8]">
                {node.count}
              </span>
            </div>
          </div>
          {open && (
            <div className="flex flex-col gap-0.5">
              {renderBranchTree(node.children, section, hasTopFolders, depth + 1)}
            </div>
          )}
        </div>
      );
    });
  };

  const renderPinnedRows = (
    items: BranchInfo[],
    section: "local" | "remote",
    hasTreeItems: boolean
  ) => {
    if (items.length === 0) return null;
    return (
      <div
        className={`flex flex-col gap-0.5 ${
          hasTreeItems ? "pb-1 mb-0.5 border-b border-[#e2e8f0]/80" : ""
        }`}
      >
        {items.map((b) => renderBranchRow(b, section))}
      </div>
    );
  };

  return (
    <aside
      style={{ width }}
      className="shrink-0 bg-[#f8fafc] flex flex-col overflow-y-auto select-none p-1.5 gap-1"
    >
      {/* WORKTREES */}
      <div>
        <div className="flex items-center justify-between px-1.5 py-1 text-[#64748b] hover:text-[#0b1c30]">
          <button
            onClick={() => setOpenWorktrees((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider cursor-pointer"
          >
            {openWorktrees ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            <span>Worktrees</span>
          </button>
          <div className="flex items-center gap-1">
            <span className="font-mono text-[11px] text-[#94a3b8]">
              {worktrees.length}
            </span>
            {hasPrunableWorktree && (
              <button
                title="Prune stale worktrees"
                onClick={onPruneWorktrees}
                className="p-0.5 rounded hover:bg-[#fef3c7] text-[#d97706] cursor-pointer"
              >
                <Eraser className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              title="Create New Worktree"
              onClick={() => onRequestCreateWorktree({ mode: "new-branch" })}
              className="p-0.5 rounded hover:bg-[#e2e8f0] text-[#64748b] hover:text-[#0284c7] cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {openWorktrees && (
          <div className="pl-2 flex flex-col gap-0.5">
            {worktrees.length === 0 ? (
              <div className="px-2 py-1 text-[12px] text-[#94a3b8]">
                No worktrees
              </div>
            ) : (
              worktrees.map((wt) => {
                const isOpenInTab =
                  !wt.isCurrent && openTabPathSet.has(wt.path.toLowerCase());
                const canOpen = !wt.isCurrent && !wt.isBare && !wt.isPrunable;
                const branchLabel = wt.isBare
                  ? "(bare)"
                  : wt.branch
                  ? wt.branch
                  : wt.isDetached
                  ? `detached@${wt.headSha}`
                  : wt.headSha;
                return (
                  <div
                    key={wt.path}
                    onDoubleClick={() => {
                      if (canOpen) onOpenWorktree(wt);
                    }}
                    onContextMenu={(e) => openWorktreeContextMenu(e, wt)}
                    title={`${wt.rawPath}\nBranch: ${branchLabel}${
                      wt.isLocked
                        ? `\nLocked${wt.lockReason ? `: ${wt.lockReason}` : ""}`
                        : ""
                    }${
                      wt.isPrunable
                        ? `\nPrunable${wt.pruneReason ? `: ${wt.pruneReason}` : ""}`
                        : ""
                    }${
                      canOpen ? "\nDouble-click to open in tab · Right-click for actions" : "\nRight-click for actions"
                    }`}
                    className={`group flex items-center justify-between px-2 py-1 rounded-md text-[13px] cursor-pointer transition-colors ${
                      wt.isCurrent
                        ? "bg-[#e0f2fe]/70 text-[#0b1c30] font-semibold"
                        : wt.isPrunable
                        ? "text-[#b45309] hover:bg-[#fef3c7]/60"
                        : "text-[#334155] hover:bg-[#f1f5f9] hover:text-[#0b1c30]"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1 pr-1">
                      {wt.isPrunable ? (
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-[#d97706]" />
                      ) : wt.isLocked ? (
                        <Lock className="w-3.5 h-3.5 shrink-0 text-[#d97706]" />
                      ) : (
                        <FolderTree
                          className={`w-3.5 h-3.5 shrink-0 ${
                            wt.isCurrent
                              ? "text-[#0284c7]"
                              : wt.isMain
                              ? "text-[#0f766e]"
                              : "text-[#64748b]"
                          }`}
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="truncate">{wt.name}</span>
                          {wt.isMain && (
                            <span className="px-1 py-[0.5px] rounded bg-[#f1f5f9] border border-[#cbd5e1] text-[9px] font-mono font-semibold text-[#475569] shrink-0">
                              MAIN
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-mono text-[#64748b] truncate">
                          {branchLabel}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {canOpen && (
                        <button
                          type="button"
                          title={isOpenInTab ? "Switch to tab" : "Open in new tab"}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenWorktree(wt);
                          }}
                          className="hidden group-hover:inline-flex p-0.5 rounded text-[#64748b] hover:text-[#0284c7] hover:bg-[#e2e8f0] cursor-pointer"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {wt.isCurrent ? (
                        <span className="px-1.5 py-[1px] rounded text-[10px] font-mono font-bold tracking-wide bg-[#0284c7] text-white">
                          CUR
                        </span>
                      ) : isOpenInTab ? (
                        <span className="px-1.5 py-[1px] rounded text-[10px] font-mono font-semibold bg-[#dcfce7] text-[#15803d]">
                          OPEN
                        </span>
                      ) : wt.isPrunable ? (
                        <span className="px-1.5 py-[1px] rounded text-[10px] font-mono font-semibold bg-[#fef3c7] text-[#b45309]">
                          GONE
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* LOCAL BRANCHES */}
      <div>
        <div className="flex items-center justify-between px-1.5 py-1 text-[#64748b] hover:text-[#0b1c30]">
          <button
            onClick={() => setOpenLocal((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider cursor-pointer"
          >
            {openLocal ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            <span>Local Branches</span>
          </button>
          <div className="flex items-center gap-1">
            <span className="font-mono text-[11px] text-[#94a3b8]">
              {localBranches.length}
            </span>
            <button
              title="New Branch"
              onClick={() => onRequestCreateBranch("", true)}
              className="p-0.5 rounded hover:bg-[#e2e8f0] text-[#64748b] hover:text-[#0284c7] cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {openLocal && (
          <div className="pl-2 flex flex-col gap-0.5">
            {/* Branch Commit View Scope Switcher */}
            <div className="grid grid-cols-2 gap-0.5 p-0.5 mb-1 rounded-md bg-[#e2e8f0]/75 border border-[#cbd5e1]/60">
              <button
                type="button"
                title="Only show commits reachable from the selected branch"
                onClick={() => onChangeBranchScopeMode("branch")}
                className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                  branchScopeMode === "branch"
                    ? "bg-white text-[#0284c7] font-semibold shadow-2xs"
                    : "text-[#64748b] hover:text-[#0b1c30]"
                }`}
              >
                Selected Only
              </button>
              <button
                type="button"
                title="Show commits across all branches (clicking a branch highlights its tip)"
                onClick={() => onChangeBranchScopeMode("all")}
                className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                  branchScopeMode === "all"
                    ? "bg-white text-[#0284c7] font-semibold shadow-2xs"
                    : "text-[#64748b] hover:text-[#0b1c30]"
                }`}
              >
                All Commits
              </button>
            </div>

            {renderPinnedRows(
              pinnedLocalBranches,
              "local",
              localTree.length > 0
            )}
            {renderBranchTree(localTree, "local", hasLocalFolders)}
          </div>
        )}
      </div>

      {/* REMOTES */}
      <div>
        <div className="flex items-center justify-between px-1.5 py-1 text-[#64748b] hover:text-[#0b1c30]">
          <button
            onClick={() => setOpenRemotes((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider cursor-pointer"
          >
            {openRemotes ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            <span>Remotes</span>
          </button>
          <span className="font-mono text-[11px] text-[#94a3b8]">
            {remoteBranches.length}
          </span>
        </div>

        {openRemotes && (
          <div className="pl-2 flex flex-col gap-0.5">
            {remoteBranches.length === 0 ? (
              <div className="px-2 py-1 text-[12px] text-[#94a3b8]">
                No remote branches
              </div>
            ) : (
              <>
                {renderPinnedRows(
                  pinnedRemoteBranches,
                  "remote",
                  remoteTree.length > 0
                )}
                {renderBranchTree(remoteTree, "remote", hasRemoteFolders)}
              </>
            )}
          </div>
        )}
      </div>

      {/* TAGS */}
      <div>
        <div className="flex items-center justify-between px-1.5 py-1 text-[#64748b] hover:text-[#0b1c30]">
          <button
            onClick={() => setOpenTags((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider cursor-pointer"
          >
            {openTags ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            <span>Tags</span>
          </button>
          <div className="flex items-center gap-1">
            <span className="font-mono text-[11px] text-[#94a3b8]">
              {tags.length}
            </span>
            <button
              title="Create Tag"
              onClick={() => onRequestCreateTag("")}
              className="p-0.5 rounded hover:bg-[#e2e8f0] text-[#64748b] hover:text-[#0284c7] cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {openTags && (
          <div className="pl-2 flex flex-col gap-0.5">
            {tags.length === 0 ? (
              <div className="px-2 py-1 text-[12px] text-[#94a3b8]">No tags</div>
            ) : (
              <>
                {(showAllTags ? tags : tags.slice(0, 40)).map((t) => {
                  const tagRef = `refs/tags/${t.name}`;
                  const isSelected =
                    selectedRef === `tag:${t.name}` ||
                    activeHistoryBranch === tagRef;
                  return (
                    <div
                      key={t.name}
                      onClick={() => {
                        setSelectedRef(`tag:${t.name}`);
                        onInspectBranch(tagRef);
                      }}
                      onDoubleClick={() => onCheckoutTag(t.name)}
                      onContextMenu={(e) => openTagContextMenu(e, t)}
                      title={`${t.name} (${t.hash})${
                        t.message ? ` — ${t.message}` : ""
                      }\nClick to view Commit Graph · Double-click to checkout · Right-click for actions`}
                      className={`flex items-center justify-between px-2 py-1 rounded-md text-[13px] cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-[#0284c7] text-white font-semibold shadow-xs"
                          : "text-[#475569] hover:bg-[#f1f5f9] hover:text-[#0b1c30]"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0 flex-1 pr-1">
                        <TagIcon
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isSelected ? "text-white/90" : "text-[#16a34a]"
                          }`}
                        />
                        <span className="truncate font-mono">{t.name}</span>
                      </div>
                      <span
                        className={`font-mono text-[11px] shrink-0 ${
                          isSelected ? "text-white/80" : "text-[#94a3b8]"
                        }`}
                      >
                        {t.hash}
                      </span>
                    </div>
                  );
                })}
                {tags.length > 40 && (
                  <button
                    onClick={() => setShowAllTags((v) => !v)}
                    className="px-2 py-1 text-left text-[11px] font-medium text-[#0284c7] hover:underline cursor-pointer"
                  >
                    {showAllTags
                      ? "Show fewer tags"
                      : `Show all ${tags.length} tags...`}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* STASHES */}
      <div>
        <div className="flex items-center justify-between px-1.5 py-1 text-[#64748b] hover:text-[#0b1c30]">
          <button
            onClick={() => setOpenStashes((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider cursor-pointer"
          >
            {openStashes ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            <span>Stashes</span>
          </button>
          <div className="flex items-center gap-1">
            <span className="font-mono text-[11px] text-[#94a3b8]">
              {stashes.length}
            </span>
            <button
              title="Stash Changes"
              onClick={onRequestStashPush}
              className="p-0.5 rounded hover:bg-[#e2e8f0] text-[#64748b] hover:text-[#0284c7] cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {openStashes && (
          <div className="pl-2 flex flex-col gap-0.5">
            {stashes.length === 0 ? (
              <div className="px-2 py-1 text-[12px] text-[#94a3b8]">
                No stashes
              </div>
            ) : (
              stashes.map((s) => (
                <div
                  key={s.ref}
                  onContextMenu={(e) => openStashContextMenu(e, s)}
                  title={`${s.ref} (${s.relativeTime}): ${s.message}\nRight-click for actions`}
                  className="flex items-center justify-between px-2 py-1 rounded-md text-[13px] text-[#334155] hover:bg-[#f1f5f9] cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1 pr-1">
                    <Archive className="w-3.5 h-3.5 shrink-0 text-[#d97706]" />
                    <span className="truncate">{s.message}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* BRANCH CONTEXT MENU */}
      {selectedBranch && ctxMenu && (
        <div
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-60 bg-white border border-[#cbd5e1] rounded-lg shadow-xl py-1 text-[13px] text-[#0b1c30]"
        >
          <div className="px-3 py-1 border-b border-[#f1f5f9] text-[11px] font-mono text-[#64748b] truncate">
            {selectedBranch.name}
          </div>

          <button
            onClick={() => {
              const b = selectedBranch;
              setCtxMenu(null);
              onTogglePinBranch(b.fullName);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#fffbeb] hover:text-[#d97706] cursor-pointer"
          >
            {pinnedSet.has(selectedBranch.fullName) ? (
              <>
                <PinOff className="w-3.5 h-3.5 text-[#d97706]" />
                <span>Unpin Branch</span>
              </>
            ) : (
              <>
                <Pin className="w-3.5 h-3.5 text-[#d97706]" />
                <span>Pin Branch to Top</span>
              </>
            )}
          </button>

          <div className="my-1 border-t border-[#f1f5f9]" />

          {!selectedBranch.isCurrent && selectedBranchInOtherWorktree ? (
            <button
              onClick={() => {
                const wt = selectedBranchInOtherWorktree;
                setCtxMenu(null);
                onOpenWorktree(wt);
              }}
              className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0fdfa] hover:text-[#0f766e] cursor-pointer"
            >
              <FolderTree className="w-3.5 h-3.5 text-[#0f766e]" />
              <span className="truncate">
                Switch to Worktree ({selectedBranchInOtherWorktree.name})
              </span>
            </button>
          ) : (
            !selectedBranch.isCurrent && (
              <button
                onClick={() => {
                  const b = selectedBranch;
                  setCtxMenu(null);
                  onCheckout(b.name, b.isRemote);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0f9ff] hover:text-[#0284c7] cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-[#0284c7]" />
                <span>Checkout {selectedBranch.isRemote ? "(Track)" : ""}</span>
              </button>
            )
          )}

          <button
            onClick={() => {
              const b = selectedBranch;
              const inOtherWt = selectedBranchInOtherWorktree;
              setCtxMenu(null);
              onRequestCreateWorktree({
                mode: inOtherWt ? "new-branch" : "existing-branch",
                branch: b.name,
                baseRef: b.name,
              });
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0f9ff] hover:text-[#0284c7] cursor-pointer"
          >
            <FolderTree className="w-3.5 h-3.5 text-[#0f766e]" />
            <span>
              {selectedBranchInOtherWorktree
                ? "New Worktree Branch from Here..."
                : "Open in New Worktree..."}
            </span>
          </button>

          <button
            onClick={() => {
              const b = selectedBranch;
              setCtxMenu(null);
              onRequestCreateBranch(b.name, false);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0f9ff] hover:text-[#0284c7] cursor-pointer"
          >
            <GitBranch className="w-3.5 h-3.5 text-[#0284c7]" />
            <span>New Branch...</span>
          </button>

          <button
            onClick={() => {
              const b = selectedBranch;
              setCtxMenu(null);
              onRequestCreateTag(b.name);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0f9ff] hover:text-[#0284c7] cursor-pointer"
          >
            <TagIcon className="w-3.5 h-3.5 text-[#16a34a]" />
            <span>New Tag...</span>
          </button>

          {!selectedBranch.isRemote && (
            <button
              onClick={() => {
                const b = selectedBranch;
                setCtxMenu(null);
                onRequestRenameBranch(b.name);
              }}
              className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0f9ff] hover:text-[#0284c7] cursor-pointer"
            >
              <Pencil className="w-3.5 h-3.5 text-[#64748b]" />
              <span>Rename...</span>
            </button>
          )}

          {!selectedBranch.isCurrent && (
            <button
              onClick={() => {
                const b = selectedBranch;
                setCtxMenu(null);
                onMerge(b.name);
              }}
              className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0f9ff] hover:text-[#0284c7] cursor-pointer"
            >
              <GitMerge className="w-3.5 h-3.5 text-[#7c3aed]" />
              <span className="truncate">Merge into {currentBranch || "HEAD"}</span>
            </button>
          )}

          {(canDeleteLocalBranch ||
            canDeleteRemoteBranch ||
            canDeleteUpstreamBranch) && (
            <div className="my-1 border-t border-[#f1f5f9]" />
          )}

          {canDeleteLocalBranch && (
            <button
              onClick={() => {
                const b = selectedBranch;
                setCtxMenu(null);
                onRequestDeleteBranch(b.name);
              }}
              className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-[#dc2626] hover:bg-[#fef2f2] cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Local Branch...</span>
            </button>
          )}

          {canDeleteRemoteBranch && (
            <button
              onClick={() => {
                const b = selectedBranch;
                setCtxMenu(null);
                onRequestDeleteRemoteBranch(b.name);
              }}
              className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-[#dc2626] hover:bg-[#fef2f2] cursor-pointer"
            >
              <CloudOff className="w-3.5 h-3.5" />
              <span>Delete Remote Branch...</span>
            </button>
          )}

          {canDeleteUpstreamBranch && (
            <button
              onClick={() => {
                const up = selectedBranch.upstream;
                setCtxMenu(null);
                onRequestDeleteRemoteBranch(up);
              }}
              className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-[#dc2626] hover:bg-[#fef2f2] cursor-pointer"
            >
              <CloudOff className="w-3.5 h-3.5" />
              <span className="truncate">
                Delete Remote ({selectedBranch.upstream})...
              </span>
            </button>
          )}
        </div>
      )}

      {/* TAG CONTEXT MENU */}
      {selectedTag && ctxMenu && (
        <div
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-60 bg-white border border-[#cbd5e1] rounded-lg shadow-xl py-1 text-[13px] text-[#0b1c30]"
        >
          <div className="px-3 py-1.5 border-b border-[#f1f5f9]">
            <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
              <span className="text-[#15803d] font-semibold truncate">
                {selectedTag.name}
              </span>
              <span className="text-[#94a3b8] shrink-0">{selectedTag.hash}</span>
            </div>
            {selectedTag.message && (
              <div className="text-[11px] text-[#64748b] truncate mt-0.5">
                {selectedTag.message}
              </div>
            )}
          </div>

          <button
            onClick={() => {
              const t = selectedTag;
              setCtxMenu(null);
              setSelectedRef(`tag:${t.name}`);
              onInspectBranch(`refs/tags/${t.name}`);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0f9ff] hover:text-[#0284c7] cursor-pointer"
          >
            <History className="w-3.5 h-3.5 text-[#0284c7]" />
            <span>View in Commit Graph</span>
          </button>

          <button
            onClick={() => {
              const t = selectedTag;
              setCtxMenu(null);
              onCheckoutTag(t.name);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0f9ff] hover:text-[#0284c7] cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-[#0284c7]" />
            <span>Checkout Tag (Detached HEAD)</span>
          </button>

          <button
            onClick={() => {
              const t = selectedTag;
              setCtxMenu(null);
              onRequestCreateBranch(`refs/tags/${t.name}`, true);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0f9ff] hover:text-[#0284c7] cursor-pointer"
          >
            <GitBranch className="w-3.5 h-3.5 text-[#0284c7]" />
            <span>New Branch from Tag...</span>
          </button>

          <button
            onClick={() => {
              const t = selectedTag;
              setCtxMenu(null);
              onRequestCreateWorktree({
                mode: "detach",
                baseRef: `refs/tags/${t.name}`,
              });
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0f9ff] hover:text-[#0284c7] cursor-pointer"
          >
            <FolderTree className="w-3.5 h-3.5 text-[#0f766e]" />
            <span>New Worktree from Tag...</span>
          </button>

          <div className="my-1 border-t border-[#f1f5f9]" />

          <button
            disabled={remotes.length === 0}
            onClick={() => {
              const t = selectedTag;
              setCtxMenu(null);
              onPushTag(t);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0f9ff] hover:text-[#0284c7] disabled:opacity-40 cursor-pointer"
          >
            <UploadCloud className="w-3.5 h-3.5 text-[#0284c7]" />
            <span className="truncate">
              {remotes.length === 1
                ? `Push Tag to ${remotes[0].name}`
                : remotes.length > 1
                ? "Push Tag to Remote..."
                : "Push Tag (No Remote)"}
            </span>
          </button>

          <button
            onClick={() => {
              const t = selectedTag;
              setCtxMenu(null);
              navigator.clipboard.writeText(t.name);
              onNotify("info", `Copied tag name ${t.name}`);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f8fafc] text-[#475569] cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy Tag Name</span>
          </button>

          <button
            onClick={() => {
              const t = selectedTag;
              setCtxMenu(null);
              navigator.clipboard.writeText(t.hash);
              onNotify("info", `Copied SHA ${t.hash}`);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f8fafc] text-[#475569] cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy SHA ({selectedTag.hash})</span>
          </button>

          <div className="my-1 border-t border-[#f1f5f9]" />

          <button
            onClick={() => {
              const t = selectedTag;
              setCtxMenu(null);
              onRequestDeleteTag(t);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-[#dc2626] hover:bg-[#fef2f2] cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete Local Tag...</span>
          </button>

          {remotes.length > 0 && (
            <button
              onClick={() => {
                const t = selectedTag;
                setCtxMenu(null);
                onRequestDeleteRemoteTag(t);
              }}
              className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-[#dc2626] hover:bg-[#fef2f2] cursor-pointer"
            >
              <CloudOff className="w-3.5 h-3.5" />
              <span>Delete Remote Tag...</span>
            </button>
          )}
        </div>
      )}

      {/* STASH CONTEXT MENU */}
      {selectedStash && ctxMenu && (
        <div
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-60 bg-white border border-[#cbd5e1] rounded-lg shadow-xl py-1 text-[13px] text-[#0b1c30]"
        >
          <div className="px-3 py-1.5 border-b border-[#f1f5f9]">
            <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
              <span className="text-[#d97706] font-semibold truncate">
                {selectedStash.ref}
              </span>
              <span className="text-[#94a3b8] shrink-0">
                {selectedStash.relativeTime}
              </span>
            </div>
            <div className="text-[11px] text-[#64748b] truncate mt-0.5">
              {selectedStash.message}
            </div>
          </div>

          <button
            onClick={() => {
              const s = selectedStash;
              setCtxMenu(null);
              onStashApply(s.ref);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0f9ff] hover:text-[#0284c7] cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 text-[#0284c7]" />
            <span>Apply Stash (Keep)</span>
          </button>

          <button
            onClick={() => {
              const s = selectedStash;
              setCtxMenu(null);
              onStashPop(s.ref);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0fdf4] hover:text-[#16a34a] cursor-pointer"
          >
            <ArrowUpFromLine className="w-3.5 h-3.5 text-[#16a34a]" />
            <span>Pop Stash (Apply & Remove)</span>
          </button>

          <div className="my-1 border-t border-[#f1f5f9]" />

          <button
            onClick={() => {
              const s = selectedStash;
              setCtxMenu(null);
              onStashDrop(s);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-[#dc2626] hover:bg-[#fef2f2] cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Drop Stash...</span>
          </button>
        </div>
      )}

      {/* WORKTREE CONTEXT MENU */}
      {selectedWorktree && ctxMenu && (
        <div
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-64 bg-white border border-[#cbd5e1] rounded-lg shadow-xl py-1 text-[13px] text-[#0b1c30]"
        >
          <div className="px-3 py-1.5 border-b border-[#f1f5f9]">
            <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
              <span className="text-[#0284c7] font-semibold truncate">
                {selectedWorktree.name}
              </span>
              {selectedWorktree.isMain && (
                <span className="px-1 rounded bg-[#f1f5f9] text-[#475569] text-[10px] shrink-0">
                  MAIN
                </span>
              )}
            </div>
            <div className="text-[10.5px] font-mono text-[#64748b] truncate mt-0.5">
              {selectedWorktree.rawPath}
            </div>
          </div>

          {!selectedWorktree.isCurrent &&
            !selectedWorktree.isBare &&
            !selectedWorktree.isPrunable && (
              <button
                onClick={() => {
                  const wt = selectedWorktree;
                  setCtxMenu(null);
                  onOpenWorktree(wt);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0f9ff] hover:text-[#0284c7] cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5 text-[#0284c7]" />
                <span>
                  {openTabPathSet.has(selectedWorktree.path.toLowerCase())
                    ? "Switch to Worktree Tab"
                    : "Open Worktree in New Tab"}
                </span>
              </button>
            )}

          {!selectedWorktree.isPrunable && (
            <>
              <button
                onClick={() => {
                  const wt = selectedWorktree;
                  setCtxMenu(null);
                  onOpenWorktreeInExplorer(wt);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f8fafc] text-[#334155] cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5 text-[#475569]" />
                <span>Open in Explorer</span>
              </button>
              <button
                onClick={() => {
                  const wt = selectedWorktree;
                  setCtxMenu(null);
                  onOpenWorktreeInTerminal(wt);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f8fafc] text-[#334155] cursor-pointer"
              >
                <Terminal className="w-3.5 h-3.5 text-[#475569]" />
                <span>Open in Terminal</span>
              </button>
            </>
          )}

          <button
            onClick={() => {
              const wt = selectedWorktree;
              setCtxMenu(null);
              navigator.clipboard.writeText(wt.rawPath);
              onNotify("info", `Copied path: ${wt.rawPath}`);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f8fafc] text-[#475569] cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy Path</span>
          </button>

          {!selectedWorktree.isMain && (
            <>
              <div className="my-1 border-t border-[#f1f5f9]" />
              {selectedWorktree.isLocked ? (
                <button
                  onClick={() => {
                    const wt = selectedWorktree;
                    setCtxMenu(null);
                    onUnlockWorktree(wt);
                  }}
                  className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#fffbeb] text-[#b45309] cursor-pointer"
                >
                  <Unlock className="w-3.5 h-3.5 text-[#d97706]" />
                  <span>Unlock Worktree</span>
                </button>
              ) : (
                <button
                  onClick={() => {
                    const wt = selectedWorktree;
                    setCtxMenu(null);
                    onRequestLockWorktree(wt);
                  }}
                  className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#fffbeb] text-[#b45309] cursor-pointer"
                >
                  <Lock className="w-3.5 h-3.5 text-[#d97706]" />
                  <span>Lock Worktree...</span>
                </button>
              )}

              {selectedWorktree.isPrunable && (
                <button
                  onClick={() => {
                    setCtxMenu(null);
                    onPruneWorktrees();
                  }}
                  className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#fffbeb] text-[#b45309] cursor-pointer"
                >
                  <Eraser className="w-3.5 h-3.5 text-[#d97706]" />
                  <span>Prune Stale Worktrees</span>
                </button>
              )}

              <button
                disabled={selectedWorktree.isCurrent}
                title={
                  selectedWorktree.isCurrent
                    ? "Switch to another tab or worktree before removing the active worktree"
                    : "Remove worktree from disk"
                }
                onClick={() => {
                  const wt = selectedWorktree;
                  setCtxMenu(null);
                  onRequestRemoveWorktree(wt);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-[#dc2626] hover:bg-[#fef2f2] disabled:opacity-40 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>
                  {selectedWorktree.isCurrent
                    ? "Remove (Active Tab)"
                    : "Remove Worktree..."}
                </span>
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
};
