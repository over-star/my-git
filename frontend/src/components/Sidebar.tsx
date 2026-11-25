import React, { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Check,
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
} from "lucide-react";
import type {
  BranchInfo,
  StashItem,
  TagInfo,
} from "../../bindings/gitpulse/internal/git/models";

interface SidebarProps {
  branches: BranchInfo[];
  tags: TagInfo[];
  stashes: StashItem[];
  currentBranch: string;
  onCheckout: (name: string, isRemote: boolean) => void;
  onMerge: (name: string) => void;
  onRequestDeleteBranch: (name: string) => void;
  onRequestDeleteRemoteBranch: (remoteBranch: string) => void;
  onRequestRenameBranch: (name: string) => void;
  onRequestCreateBranch: (startPoint?: string, checkout?: boolean) => void;
  onRequestCreateTag: (target?: string) => void;
  onRequestStashPush: () => void;
  onStashApply: (ref: string) => void;
  onStashPop: (ref: string) => void;
  onStashDrop: (ref: string) => void;
}

interface BranchContextMenuState {
  x: number;
  y: number;
  branch: BranchInfo;
}

export const Sidebar: React.FC<SidebarProps> = ({
  branches,
  tags,
  stashes,
  currentBranch,
  onCheckout,
  onMerge,
  onRequestDeleteBranch,
  onRequestDeleteRemoteBranch,
  onRequestRenameBranch,
  onRequestCreateBranch,
  onRequestCreateTag,
  onRequestStashPush,
  onStashApply,
  onStashPop,
  onStashDrop,
}) => {
  const [openLocal, setOpenLocal] = useState(true);
  const [openRemotes, setOpenRemotes] = useState(true);
  const [openTags, setOpenTags] = useState(false);
  const [openStashes, setOpenStashes] = useState(true);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<BranchContextMenuState | null>(null);

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

  const openContextMenu = (e: React.MouseEvent, branch: BranchInfo) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedBranch(branch.fullName);
    const menuWidth = 224;
    const menuHeight = 290;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8);
    setCtxMenu({ x, y, branch });
  };

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
              const isSelected = selectedBranch === b.fullName;
              return (
                <div
                  key={b.fullName}
                  onClick={() => setSelectedBranch(b.fullName)}
                  onDoubleClick={() => {
                    if (!b.isCurrent) onCheckout(b.name, false);
                  }}
                  onContextMenu={(e) => openContextMenu(e, b)}
                  title={
                    b.isCurrent
                      ? `Current branch: ${b.name} (Right-click for actions)`
                      : `Double-click to switch to ${b.name} · Right-click for actions`
                  }
                  className={`group flex items-center justify-between px-2 py-1 rounded text-[12px] cursor-pointer transition-colors ${
                    b.isCurrent
                      ? "bg-[#e0f2fe] text-[#0369a1] font-semibold"
                      : isSelected
                      ? "bg-[#dbeafe]/70 text-[#0b1c30] ring-1 ring-[#93c5fd]"
                      : "text-[#334155] hover:bg-[#f1f5f9] hover:text-[#0b1c30]"
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    {b.isCurrent ? (
                      <Check className="w-3.5 h-3.5 shrink-0 text-[#0284c7]" />
                    ) : (
                      <GitBranch className="w-3.5 h-3.5 shrink-0 text-[#94a3b8]" />
                    )}
                    <span className="truncate">{b.name}</span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {(b.ahead > 0 || b.behind > 0) && (
                      <span className="font-mono text-[10px] text-[#64748b]">
                        {b.ahead > 0 ? `↑${b.ahead}` : ""}
                        {b.behind > 0 ? `↓${b.behind}` : ""}
                      </span>
                    )}
                    {b.isCurrent ? (
                      <span className="px-1 py-0.2 rounded bg-white/80 border border-[#bae6fd] text-[9px] font-mono font-semibold text-[#0284c7]">
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
                          className="p-0.5 rounded hover:bg-[#dbeafe] text-[#0284c7] cursor-pointer"
                        >
                          <GitMerge className="w-3 h-3" />
                        </button>
                        <button
                          title={`Delete '${b.name}'`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onRequestDeleteBranch(b.name);
                          }}
                          className="p-0.5 rounded hover:bg-[#fee2e2] text-[#dc2626] cursor-pointer"
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
                const isSelected = selectedBranch === b.fullName;
                return (
                  <div
                    key={b.fullName}
                    onClick={() => setSelectedBranch(b.fullName)}
                    onDoubleClick={() => onCheckout(b.name, true)}
                    onContextMenu={(e) => openContextMenu(e, b)}
                    title={`Double-click to checkout tracking branch for ${b.name} · Right-click for actions`}
                    className={`group flex items-center justify-between px-2 py-1 rounded text-[12px] cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-[#dbeafe]/70 text-[#0b1c30] ring-1 ring-[#93c5fd]"
                        : "text-[#475569] hover:bg-[#f1f5f9] hover:text-[#0b1c30]"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <Cloud className="w-3.5 h-3.5 shrink-0 text-[#ea580c]/80" />
                      <span className="truncate">{b.name}</span>
                    </div>
                    <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                      <button
                        title={`Merge '${b.name}' into '${currentBranch}'`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onMerge(b.name);
                        }}
                        className="p-0.5 rounded hover:bg-[#dbeafe] text-[#0284c7] cursor-pointer"
                      >
                        <GitMerge className="w-3 h-3" />
                      </button>
                      <button
                        title={`Delete remote branch '${b.name}'`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRequestDeleteRemoteBranch(b.name);
                        }}
                        className="p-0.5 rounded hover:bg-[#fee2e2] text-[#dc2626] cursor-pointer"
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
              tags.slice(0, 40).map((t) => (
                <div
                  key={t.name}
                  title={t.message || t.hash}
                  className="flex items-center justify-between px-2 py-1 rounded text-[11px] text-[#475569] hover:bg-[#f1f5f9]"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <TagIcon className="w-3 h-3 shrink-0 text-[#16a34a]" />
                    <span className="truncate font-mono">{t.name}</span>
                  </div>
                  <span className="font-mono text-[10px] text-[#94a3b8]">
                    {t.hash}
                  </span>
                </div>
              ))
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
      {ctxMenu && (
        <div
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-56 bg-white border border-[#cbd5e1] rounded-lg shadow-xl py-1 text-[12px] text-[#0b1c30]"
        >
          <div className="px-3 py-1 border-b border-[#f1f5f9] text-[10px] font-mono text-[#64748b] truncate">
            {ctxMenu.branch.name}
          </div>

          {!ctxMenu.branch.isCurrent && (
            <button
              onClick={() => {
                const b = ctxMenu.branch;
                setCtxMenu(null);
                onCheckout(b.name, b.isRemote);
              }}
              className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0f9ff] hover:text-[#0284c7] cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-[#0284c7]" />
              <span>Checkout {ctxMenu.branch.isRemote ? "(Track)" : ""}</span>
            </button>
          )}

          <button
            onClick={() => {
              const b = ctxMenu.branch;
              setCtxMenu(null);
              onRequestCreateBranch(b.name, true);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0f9ff] hover:text-[#0284c7] cursor-pointer"
          >
            <GitBranch className="w-3.5 h-3.5 text-[#0284c7]" />
            <span>New Branch & Checkout...</span>
          </button>

          <button
            onClick={() => {
              const b = ctxMenu.branch;
              setCtxMenu(null);
              onRequestCreateBranch(b.name, false);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0f9ff] hover:text-[#0284c7] cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-[#64748b]" />
            <span>New Branch...</span>
          </button>

          <button
            onClick={() => {
              const b = ctxMenu.branch;
              setCtxMenu(null);
              onRequestCreateTag(b.name);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0f9ff] hover:text-[#0284c7] cursor-pointer"
          >
            <TagIcon className="w-3.5 h-3.5 text-[#16a34a]" />
            <span>New Tag...</span>
          </button>

          {!ctxMenu.branch.isRemote && (
            <button
              onClick={() => {
                const b = ctxMenu.branch;
                setCtxMenu(null);
                onRequestRenameBranch(b.name);
              }}
              className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0f9ff] hover:text-[#0284c7] cursor-pointer"
            >
              <Pencil className="w-3.5 h-3.5 text-[#64748b]" />
              <span>Rename...</span>
            </button>
          )}

          {!ctxMenu.branch.isCurrent && (
            <button
              onClick={() => {
                const b = ctxMenu.branch;
                setCtxMenu(null);
                onMerge(b.name);
              }}
              className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0f9ff] hover:text-[#0284c7] cursor-pointer"
            >
              <GitMerge className="w-3.5 h-3.5 text-[#7c3aed]" />
              <span className="truncate">Merge into {currentBranch || "HEAD"}</span>
            </button>
          )}

          {(!ctxMenu.branch.isCurrent || ctxMenu.branch.isRemote || ctxMenu.branch.upstream) && (
            <div className="my-1 border-t border-[#f1f5f9]" />
          )}

          {!ctxMenu.branch.isRemote && !ctxMenu.branch.isCurrent && (
            <button
              onClick={() => {
                const b = ctxMenu.branch;
                setCtxMenu(null);
                onRequestDeleteBranch(b.name);
              }}
              className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-[#dc2626] hover:bg-[#fef2f2] cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Local Branch...</span>
            </button>
          )}

          {ctxMenu.branch.isRemote && (
            <button
              onClick={() => {
                const b = ctxMenu.branch;
                setCtxMenu(null);
                onRequestDeleteRemoteBranch(b.name);
              }}
              className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-[#dc2626] hover:bg-[#fef2f2] cursor-pointer"
            >
              <CloudOff className="w-3.5 h-3.5" />
              <span>Delete Remote Branch...</span>
            </button>
          )}

          {!ctxMenu.branch.isRemote && ctxMenu.branch.upstream && (
            <button
              onClick={() => {
                const up = ctxMenu.branch.upstream;
                setCtxMenu(null);
                onRequestDeleteRemoteBranch(up);
              }}
              className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-[#dc2626] hover:bg-[#fef2f2] cursor-pointer"
            >
              <CloudOff className="w-3.5 h-3.5" />
              <span className="truncate">Delete Remote ({ctxMenu.branch.upstream})...</span>
            </button>
          )}
        </div>
      )}
    </aside>
  );
};
