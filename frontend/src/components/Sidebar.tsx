import React, { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Cloud,
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
  Copy,
  History,
  UploadCloud,
} from "lucide-react";
import type {
  BranchInfo,
  RemoteInfo,
  StashItem,
  TagInfo,
} from "../../bindings/gitpulse/internal/git/models";

interface SidebarProps {
  branches: BranchInfo[];
  tags: TagInfo[];
  stashes: StashItem[];
  remotes: RemoteInfo[];
  currentBranch: string;
  activeHistoryBranch: string;
  onInspectBranch: (name: string) => void;
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
  onStashDrop: (ref: string) => void;
  onNotify: (type: "success" | "error" | "info", msg: string) => void;
}

type ContextMenuState =
  | { kind: "branch"; x: number; y: number; branch: BranchInfo }
  | { kind: "tag"; x: number; y: number; tag: TagInfo };

export const Sidebar: React.FC<SidebarProps> = ({
  branches,
  tags,
  stashes,
  remotes,
  currentBranch,
  activeHistoryBranch,
  onInspectBranch,
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
  onNotify,
}) => {
  const [openLocal, setOpenLocal] = useState(true);
  const [openRemotes, setOpenRemotes] = useState(true);
  const [openTags, setOpenTags] = useState(false);
  const [showAllTags, setShowAllTags] = useState(false);
  const [openStashes, setOpenStashes] = useState(true);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    if (activeHistoryBranch === "__ALL__") {
      setSelectedRef(null);
    }
  }, [activeHistoryBranch]);

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
    const menuWidth = 224;
    return {
      x: Math.min(e.clientX, window.innerWidth - menuWidth - 8),
      y: Math.min(e.clientY, window.innerHeight - menuHeight - 8),
    };
  };

  const openBranchContextMenu = (e: React.MouseEvent, branch: BranchInfo) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedRef(branch.fullName);
    const { x, y } = clampMenuPos(e, 290);
    setCtxMenu({ kind: "branch", x, y, branch });
  };

  const openTagContextMenu = (e: React.MouseEvent, tag: TagInfo) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedRef(`tag:${tag.name}`);
    const { x, y } = clampMenuPos(e, 300);
    setCtxMenu({ kind: "tag", x, y, tag });
  };

  const selectedBranch = ctxMenu?.kind === "branch" ? ctxMenu.branch : null;
  const selectedTag = ctxMenu?.kind === "tag" ? ctxMenu.tag : null;

  const localBranches = branches.filter((b) => !b.isRemote);
  const remoteBranches = branches.filter((b) => b.isRemote);

  return (
    <aside className="w-60 shrink-0 bg-[#f8fafc] border-r border-[#e2e8f0] flex flex-col overflow-y-auto select-none p-1.5 gap-1">
      {/* LOCAL BRANCHES */}
      <div>
        <div className="flex items-center justify-between px-1.5 py-1 text-[#64748b] hover:text-[#0b1c30]">
          <button
            onClick={() => setOpenLocal((v) => !v)}
            className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider cursor-pointer"
          >
            {openLocal ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            <span>Local Branches</span>
          </button>
          <div className="flex items-center gap-1">
            <span className="font-mono text-[10px] text-[#94a3b8]">
              {localBranches.length}
            </span>
            <button
              title="New Branch"
              onClick={() => onRequestCreateBranch("", true)}
              className="p-0.5 rounded hover:bg-[#e2e8f0] text-[#64748b] hover:text-[#0284c7] cursor-pointer"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>

        {openLocal && (
          <div className="pl-2 flex flex-col gap-0.5">
            {localBranches.map((b) => {
              const isSelected =
                selectedRef === b.fullName || activeHistoryBranch === b.name;
              return (
                <div
                  key={b.fullName}
                  onClick={() => {
                    setSelectedRef(b.fullName);
                    onInspectBranch(b.name);
                  }}
                  onDoubleClick={() => {
                    if (!b.isCurrent) onCheckout(b.name, false);
                  }}
                  onContextMenu={(e) => openBranchContextMenu(e, b)}
                  title={
                    b.isCurrent
                      ? `Current branch: ${b.name} · Click to view Commit Graph · Right-click for actions`
                      : `Click to view Commit Graph · Double-click to checkout ${b.name} · Right-click for actions`
                  }
                  className={`group flex items-center justify-between px-2 py-1 rounded-md text-[12px] cursor-pointer transition-colors ${
                    isSelected
                      ? b.isCurrent
                        ? "bg-[#0284c7] text-white font-bold shadow-xs shadow-[inset_3px_0_0_#4ade80]"
                        : "bg-[#0284c7] text-white font-semibold shadow-xs"
                      : b.isCurrent
                      ? "bg-[#ecfdf5] text-[#065f46] font-bold border border-[#a7f3d0] shadow-[inset_3px_0_0_#16a34a]"
                      : "text-[#334155] hover:bg-[#f1f5f9] hover:text-[#0b1c30]"
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    {b.isCurrent ? (
                      <CheckCircle2
                        className={`w-3.5 h-3.5 shrink-0 ${
                          isSelected ? "text-[#86efac]" : "text-[#16a34a]"
                        }`}
                      />
                    ) : (
                      <GitBranch
                        className={`w-3.5 h-3.5 shrink-0 ${
                          isSelected ? "text-white/90" : "text-[#94a3b8]"
                        }`}
                      />
                    )}
                    <span className="truncate">{b.name}</span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {b.ahead > 0 && (
                      <span
                        title={`${b.ahead} unpushed commit(s)`}
                        className={`px-1.5 py-0.2 rounded-full font-mono text-[10px] font-semibold leading-tight ${
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
                        className={`px-1.5 py-0.2 rounded-full font-mono text-[10px] font-semibold leading-tight ${
                          isSelected
                            ? "bg-white/20 text-white"
                            : "bg-[#fef3c7] border border-[#fde68a] text-[#b45309]"
                        }`}
                      >
                        ↓{b.behind}
                      </span>
                    )}
                    {b.isCurrent ? (
                      <span
                        className={`px-1.5 py-[1px] rounded text-[9px] font-mono font-bold tracking-wide ${
                          isSelected
                            ? "bg-[#22c55e] text-white"
                            : "bg-[#16a34a] text-white"
                        }`}
                      >
                        HEAD
                      </span>
                    ) : (
                      <div className="hidden group-hover:flex items-center gap-0.5">
                        <button
                          title={`Merge '${b.name}' into '${currentBranch}'`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onMerge(b.name);
                          }}
                          className={`p-0.5 rounded cursor-pointer ${
                            isSelected
                              ? "hover:bg-white/20 text-white"
                              : "hover:bg-[#dbeafe] text-[#0284c7]"
                          }`}
                        >
                          <GitMerge className="w-3 h-3" />
                        </button>
                        <button
                          title={`Delete '${b.name}'`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onRequestDeleteBranch(b.name);
                          }}
                          className={`p-0.5 rounded cursor-pointer ${
                            isSelected
                              ? "hover:bg-white/20 text-white"
                              : "hover:bg-[#fee2e2] text-[#dc2626]"
                          }`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* REMOTES */}
      <div>
        <div className="flex items-center justify-between px-1.5 py-1 text-[#64748b] hover:text-[#0b1c30]">
          <button
            onClick={() => setOpenRemotes((v) => !v)}
            className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider cursor-pointer"
          >
            {openRemotes ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            <span>Remotes</span>
          </button>
          <span className="font-mono text-[10px] text-[#94a3b8]">
            {remoteBranches.length}
          </span>
        </div>

        {openRemotes && (
          <div className="pl-2 flex flex-col gap-0.5">
            {remoteBranches.length === 0 ? (
              <div className="px-2 py-1 text-[11px] text-[#94a3b8]">
                No remote branches
              </div>
            ) : (
              remoteBranches.map((b) => {
                const isSelected =
                  selectedRef === b.fullName || activeHistoryBranch === b.name;
                return (
                  <div
                    key={b.fullName}
                    onClick={() => {
                      setSelectedRef(b.fullName);
                      onInspectBranch(b.name);
                    }}
                    onDoubleClick={() => onCheckout(b.name, true)}
                    onContextMenu={(e) => openBranchContextMenu(e, b)}
                    title={`Click to view Commit Graph · Double-click to checkout tracking branch for ${b.name} · Right-click for actions`}
                    className={`group flex items-center justify-between px-2 py-1 rounded-md text-[12px] cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-[#0284c7] text-white font-semibold shadow-xs"
                        : "text-[#475569] hover:bg-[#f1f5f9] hover:text-[#0b1c30]"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <Cloud
                        className={`w-3.5 h-3.5 shrink-0 ${
                          isSelected ? "text-white/90" : "text-[#ea580c]/80"
                        }`}
                      />
                      <span className="truncate">{b.name}</span>
                    </div>
                    <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                      <button
                        title={`Merge '${b.name}' into '${currentBranch}'`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onMerge(b.name);
                        }}
                        className={`p-0.5 rounded cursor-pointer ${
                          isSelected
                            ? "hover:bg-white/20 text-white"
                            : "hover:bg-[#dbeafe] text-[#0284c7]"
                        }`}
                      >
                        <GitMerge className="w-3 h-3" />
                      </button>
                      <button
                        title={`Delete remote branch '${b.name}'`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRequestDeleteRemoteBranch(b.name);
                        }}
                        className={`p-0.5 rounded cursor-pointer ${
                          isSelected
                            ? "hover:bg-white/20 text-white"
                            : "hover:bg-[#fee2e2] text-[#dc2626]"
                        }`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* TAGS */}
      <div>
        <div className="flex items-center justify-between px-1.5 py-1 text-[#64748b] hover:text-[#0b1c30]">
          <button
            onClick={() => setOpenTags((v) => !v)}
            className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider cursor-pointer"
          >
            {openTags ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            <span>Tags</span>
          </button>
          <div className="flex items-center gap-1">
            <span className="font-mono text-[10px] text-[#94a3b8]">
              {tags.length}
            </span>
            <button
              title="Create Tag"
              onClick={() => onRequestCreateTag("")}
              className="p-0.5 rounded hover:bg-[#e2e8f0] text-[#64748b] hover:text-[#0284c7] cursor-pointer"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>

        {openTags && (
          <div className="pl-2 flex flex-col gap-0.5">
            {tags.length === 0 ? (
              <div className="px-2 py-1 text-[11px] text-[#94a3b8]">No tags</div>
            ) : (
              <>
                {(showAllTags ? tags : tags.slice(0, 40)).map((t) => {
                  const isSelected =
                    selectedRef === `tag:${t.name}` ||
                    activeHistoryBranch === t.name;
                  return (
                    <div
                      key={t.name}
                      onClick={() => {
                        setSelectedRef(`tag:${t.name}`);
                        onInspectBranch(t.name);
                      }}
                      onDoubleClick={() => onCheckoutTag(t.name)}
                      onContextMenu={(e) => openTagContextMenu(e, t)}
                      title={`${t.name} (${t.hash})${
                        t.message ? ` — ${t.message}` : ""
                      }\nClick to view Commit Graph · Double-click to checkout · Right-click for actions`}
                      className={`group flex items-center justify-between px-2 py-1 rounded-md text-[11px] cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-[#0284c7] text-white font-semibold shadow-xs"
                          : "text-[#475569] hover:bg-[#f1f5f9] hover:text-[#0b1c30]"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0 flex-1 pr-1">
                        <TagIcon
                          className={`w-3 h-3 shrink-0 ${
                            isSelected ? "text-white/90" : "text-[#16a34a]"
                          }`}
                        />
                        <span className="truncate font-mono">{t.name}</span>
                      </div>
                      <span
                        className={`font-mono text-[10px] group-hover:hidden shrink-0 ${
                          isSelected ? "text-white/80" : "text-[#94a3b8]"
                        }`}
                      >
                        {t.hash}
                      </span>
                      <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                        {remotes.length > 0 && (
                          <button
                            title={`Push tag '${t.name}' to remote`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onPushTag(t);
                            }}
                            className={`p-0.5 rounded cursor-pointer ${
                              isSelected
                                ? "hover:bg-white/20 text-white"
                                : "hover:bg-[#dbeafe] text-[#0284c7]"
                            }`}
                          >
                            <UploadCloud className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          title={`Delete tag '${t.name}'`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onRequestDeleteTag(t);
                          }}
                          className={`p-0.5 rounded cursor-pointer ${
                            isSelected
                              ? "hover:bg-white/20 text-white"
                              : "hover:bg-[#fee2e2] text-[#dc2626]"
                          }`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {tags.length > 40 && (
                  <button
                    onClick={() => setShowAllTags((v) => !v)}
                    className="px-2 py-1 text-left text-[10px] font-medium text-[#0284c7] hover:underline cursor-pointer"
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
            className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider cursor-pointer"
          >
            {openStashes ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            <span>Stashes</span>
          </button>
          <div className="flex items-center gap-1">
            <span className="font-mono text-[10px] text-[#94a3b8]">
              {stashes.length}
            </span>
            <button
              title="Stash Changes"
              onClick={onRequestStashPush}
              className="p-0.5 rounded hover:bg-[#e2e8f0] text-[#64748b] hover:text-[#0284c7] cursor-pointer"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>

        {openStashes && (
          <div className="pl-2 flex flex-col gap-0.5">
            {stashes.length === 0 ? (
              <div className="px-2 py-1 text-[11px] text-[#94a3b8]">
                No stashes
              </div>
            ) : (
              stashes.map((s) => (
                <div
                  key={s.ref}
                  title={`${s.ref} (${s.relativeTime}): ${s.message}`}
                  className="group flex items-center justify-between px-2 py-1 rounded text-[11px] text-[#334155] hover:bg-[#f1f5f9]"
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1 pr-1">
                    <Archive className="w-3 h-3 shrink-0 text-[#d97706]" />
                    <span className="truncate">{s.message}</span>
                  </div>
                  <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                    <button
                      title="Apply (keep stash)"
                      onClick={() => onStashApply(s.ref)}
                      className="p-0.5 rounded hover:bg-[#dbeafe] text-[#0284c7] cursor-pointer"
                    >
                      <Play className="w-3 h-3" />
                    </button>
                    <button
                      title="Pop (apply & remove)"
                      onClick={() => onStashPop(s.ref)}
                      className="p-0.5 rounded hover:bg-[#dcfce7] text-[#16a34a] cursor-pointer"
                    >
                      <ArrowUpFromLine className="w-3 h-3" />
                    </button>
                    <button
                      title="Drop (delete)"
                      onClick={() => onStashDrop(s.ref)}
                      className="p-0.5 rounded hover:bg-[#fee2e2] text-[#dc2626] cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
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
          className="fixed z-50 w-56 bg-white border border-[#cbd5e1] rounded-lg shadow-xl py-1 text-[12px] text-[#0b1c30]"
        >
          <div className="px-3 py-1 border-b border-[#f1f5f9] text-[10px] font-mono text-[#64748b] truncate">
            {selectedBranch.name}
          </div>

          {!selectedBranch.isCurrent && (
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
          )}

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

          {(!selectedBranch.isCurrent ||
            selectedBranch.isRemote ||
            selectedBranch.upstream) && (
            <div className="my-1 border-t border-[#f1f5f9]" />
          )}

          {!selectedBranch.isRemote && !selectedBranch.isCurrent && (
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

          {selectedBranch.isRemote && (
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

          {!selectedBranch.isRemote && selectedBranch.upstream && (
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
          className="fixed z-50 w-56 bg-white border border-[#cbd5e1] rounded-lg shadow-xl py-1 text-[12px] text-[#0b1c30]"
        >
          <div className="px-3 py-1.5 border-b border-[#f1f5f9]">
            <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
              <span className="text-[#15803d] font-semibold truncate">
                {selectedTag.name}
              </span>
              <span className="text-[#94a3b8] shrink-0">{selectedTag.hash}</span>
            </div>
            {selectedTag.message && (
              <div className="text-[10px] text-[#64748b] truncate mt-0.5">
                {selectedTag.message}
              </div>
            )}
          </div>

          <button
            onClick={() => {
              const t = selectedTag;
              setCtxMenu(null);
              setSelectedRef(`tag:${t.name}`);
              onInspectBranch(t.name);
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
    </aside>
  );
};
