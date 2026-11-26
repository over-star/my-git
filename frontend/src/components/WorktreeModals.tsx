import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderTree,
  GitBranch,
  Lock,
  Trash2,
  X,
} from "lucide-react";
import { GitService } from "../../bindings/gitpulse";
import type {
  BranchInfo,
  RepoLocation,
  WSLEntry,
  WorktreeInfo,
} from "../../bindings/gitpulse/internal/git/models";

function sanitizeBranchForFolder(branchOrRef: string): string {
  return branchOrRef
    .trim()
    .replace(/^refs\/(heads|remotes|tags)\//, "")
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function suggestWorktreePath(
  repo: RepoLocation | null,
  suffixRaw: string
): string {
  if (!repo) return "";
  const suffix = sanitizeBranchForFolder(suffixRaw) || "wt";
  if (repo.isWsl) {
    const cleanLinux = repo.linuxPath.replace(/\/+$/, "");
    const idx = cleanLinux.lastIndexOf("/");
    const parent = idx > 0 ? cleanLinux.slice(0, idx) : "";
    const base = idx >= 0 ? cleanLinux.slice(idx + 1) : cleanLinux;
    return `${parent}/${base}-${suffix}`;
  }
  const cleanWin = repo.path.replace(/[\\/]+$/, "");
  const sep = cleanWin.includes("\\") ? "\\" : "/";
  const idx = Math.max(cleanWin.lastIndexOf("\\"), cleanWin.lastIndexOf("/"));
  const parent = idx > 0 ? cleanWin.slice(0, idx) : "";
  const base = idx >= 0 ? cleanWin.slice(idx + 1) : cleanWin;
  return parent ? `${parent}${sep}${base}-${suffix}` : `${base}-${suffix}`;
}

export interface CreateWorktreePayload {
  targetPath: string;
  branch: string;
  baseRef: string;
  createBranch: boolean;
  detach: boolean;
  force: boolean;
  openInTab: boolean;
}

export const CreateWorktreeModal: React.FC<{
  open: boolean;
  repo: RepoLocation | null;
  branches: BranchInfo[];
  worktrees: WorktreeInfo[];
  initialMode?: "new-branch" | "existing-branch" | "detach";
  initialBranch?: string;
  initialBaseRef?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (payload: CreateWorktreePayload) => void;
}> = ({
  open,
  repo,
  branches,
  worktrees,
  initialMode = "new-branch",
  initialBranch = "",
  initialBaseRef = "",
  busy = false,
  onCancel,
  onConfirm,
}) => {
  const [mode, setMode] = useState<"new-branch" | "existing-branch" | "detach">(
    initialMode
  );
  const [newBranchName, setNewBranchName] = useState("");
  const [baseRef, setBaseRef] = useState("");
  const [existingBranch, setExistingBranch] = useState("");
  const [detachRef, setDetachRef] = useState("");
  const [targetPath, setTargetPath] = useState("");
  const [pathTouched, setPathTouched] = useState(false);
  const [openInTab, setOpenInTab] = useState(true);
  const [force, setForce] = useState(false);

  // Inline WSL folder browser
  const [wslBrowserOpen, setWslBrowserOpen] = useState(false);
  const [wslBrowsePath, setWslBrowsePath] = useState("/");
  const [wslEntries, setWslEntries] = useState<WSLEntry[]>([]);
  const [wslLoading, setWslLoading] = useState(false);

  const worktreeByBranch = useMemo(() => {
    const map = new Map<string, WorktreeInfo>();
    for (const wt of worktrees) {
      if (wt.branch) map.set(wt.branch, wt);
    }
    return map;
  }, [worktrees]);

  const localBranches = useMemo(
    () => branches.filter((b) => !b.isRemote),
    [branches]
  );
  const remoteBranches = useMemo(
    () => branches.filter((b) => b.isRemote),
    [branches]
  );

  useEffect(() => {
    if (!open || !repo) return;
    setMode(initialMode);
    setForce(false);
    setOpenInTab(true);
    setPathTouched(false);
    setWslBrowserOpen(false);

    const firstUnusedLocal =
      localBranches.find((b) => !worktreeByBranch.has(b.name))?.name ?? "";
    const defaultExisting =
      initialBranch ||
      firstUnusedLocal ||
      remoteBranches[0]?.name ||
      localBranches[0]?.name ||
      "";
    setExistingBranch(defaultExisting);
    setNewBranchName("");
    setBaseRef(initialBaseRef || "");
    setDetachRef(initialBaseRef || "HEAD");

    const seedSuffix =
      initialMode === "existing-branch"
        ? defaultExisting
        : initialMode === "detach"
        ? initialBaseRef || "detached"
        : "wt";
    setTargetPath(suggestWorktreePath(repo, seedSuffix));
  }, [open, repo, initialMode, initialBranch, initialBaseRef]);

  useEffect(() => {
    if (!open || !repo || pathTouched) return;
    if (mode === "new-branch") {
      setTargetPath(suggestWorktreePath(repo, newBranchName || "wt"));
    } else if (mode === "existing-branch") {
      setTargetPath(suggestWorktreePath(repo, existingBranch || "wt"));
    } else {
      setTargetPath(suggestWorktreePath(repo, detachRef || "detached"));
    }
  }, [open, repo, pathTouched, mode, newBranchName, existingBranch, detachRef]);

  const loadWslDir = async (linuxDir: string) => {
    if (!repo?.isWsl) return;
    setWslLoading(true);
    try {
      const res = await GitService.BrowseWSLDir(repo.distro, linuxDir || "/");
      setWslBrowsePath(res.path || "/");
      setWslEntries(res.entries ?? []);
    } catch {
      // ignore browse error in helper
    } finally {
      setWslLoading(false);
    }
  };

  if (!open || !repo) return null;

  const existingInUseWt =
    mode === "existing-branch" && existingBranch
      ? worktreeByBranch.get(existingBranch)
      : undefined;

  const canSubmit =
    !busy &&
    targetPath.trim() !== "" &&
    (mode === "new-branch"
      ? newBranchName.trim() !== ""
      : mode === "existing-branch"
      ? existingBranch.trim() !== ""
      : detachRef.trim() !== "");

  const submit = () => {
    if (!canSubmit) return;
    if (mode === "new-branch") {
      onConfirm({
        targetPath: targetPath.trim(),
        branch: newBranchName.trim(),
        baseRef: baseRef.trim(),
        createBranch: true,
        detach: false,
        force,
        openInTab,
      });
    } else if (mode === "existing-branch") {
      onConfirm({
        targetPath: targetPath.trim(),
        branch: existingBranch.trim(),
        baseRef: "",
        createBranch: false,
        detach: false,
        force,
        openInTab,
      });
    } else {
      onConfirm({
        targetPath: targetPath.trim(),
        branch: "",
        baseRef: detachRef.trim() || "HEAD",
        createBranch: false,
        detach: true,
        force,
        openInTab,
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0f172a]/30 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white border border-[#cbd5e1] rounded-xl shadow-xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#0b1c30]">
            <FolderTree className="w-4 h-4 text-[#0284c7]" />
            Create Git Worktree
          </div>
          <button
            onClick={onCancel}
            className="text-[#64748b] hover:text-[#0b1c30] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[#f1f5f9] border border-[#e2e8f0]">
          {(
            [
              { id: "new-branch", label: "New Branch" },
              { id: "existing-branch", label: "Existing Branch" },
              { id: "detach", label: "Detached HEAD" },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                mode === m.id
                  ? "bg-white text-[#0284c7] font-semibold shadow-xs"
                  : "text-[#64748b] hover:text-[#0b1c30]"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === "new-branch" && (
          <div className="flex flex-col gap-2.5">
            <div>
              <label className="block text-[11px] font-semibold text-[#475569] mb-1">
                New Branch Name
              </label>
              <input
                autoFocus
                type="text"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                placeholder="feat/my-worktree"
                className="w-full px-2.5 py-1.5 rounded border border-[#cbd5e1] focus:border-[#0284c7] text-xs font-mono outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#475569] mb-1">
                Base Commit / Branch (blank = HEAD)
              </label>
              <input
                type="text"
                value={baseRef}
                onChange={(e) => setBaseRef(e.target.value)}
                placeholder="HEAD"
                className="w-full px-2.5 py-1.5 rounded border border-[#cbd5e1] focus:border-[#0284c7] text-xs font-mono outline-none"
              />
              {localBranches.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap mt-1.5">
                  <span className="text-[10.5px] text-[#64748b]">Quick base:</span>
                  {localBranches.slice(0, 5).map((b) => (
                    <button
                      key={b.fullName}
                      type="button"
                      onClick={() => setBaseRef(b.name)}
                      className={`px-1.5 py-0.5 rounded font-mono text-[10.5px] border cursor-pointer ${
                        baseRef === b.name
                          ? "bg-[#e0f2fe] border-[#7dd3fc] text-[#0369a1] font-semibold"
                          : "bg-[#f8fafc] border-[#e2e8f0] hover:bg-[#f1f5f9] text-[#475569]"
                      }`}
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {mode === "existing-branch" && (
          <div className="flex flex-col gap-1.5">
            <label className="block text-[11px] font-semibold text-[#475569]">
              Branch to Checkout in Worktree
            </label>
            <select
              value={existingBranch}
              onChange={(e) => setExistingBranch(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-xs font-mono outline-none"
            >
              {localBranches.length > 0 && (
                <optgroup label="Local Branches">
                  {localBranches.map((b) => {
                    const holder = worktreeByBranch.get(b.name);
                    return (
                      <option key={b.fullName} value={b.name}>
                        {b.name}
                        {holder ? ` (checked out in ${holder.name})` : ""}
                      </option>
                    );
                  })}
                </optgroup>
              )}
              {remoteBranches.length > 0 && (
                <optgroup label="Remote Branches (auto-track)">
                  {remoteBranches.map((b) => (
                    <option key={b.fullName} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {existingInUseWt && (
              <div className="flex items-start gap-1.5 px-2.5 py-1.5 rounded bg-[#fffbeb] border border-[#fde68a] text-[11px] text-[#92400e]">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#d97706]" />
                <span>
                  Branch <code className="font-mono font-semibold">{existingBranch}</code> is
                  already checked out at{" "}
                  <code className="font-mono">{existingInUseWt.rawPath}</code>. Git normally
                  prevents checking out the same branch in two worktrees unless Force is checked.
                </span>
              </div>
            )}
          </div>
        )}

        {mode === "detach" && (
          <div>
            <label className="block text-[11px] font-semibold text-[#475569] mb-1">
              Target Commit / Tag / Ref
            </label>
            <input
              autoFocus
              type="text"
              value={detachRef}
              onChange={(e) => setDetachRef(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="HEAD"
              className="w-full px-2.5 py-1.5 rounded border border-[#cbd5e1] focus:border-[#0284c7] text-xs font-mono outline-none"
            />
          </div>
        )}

        {/* Target Path */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-semibold text-[#475569]">
              Worktree Directory {repo.isWsl ? `(WSL2: ${repo.distro})` : ""}
            </label>
            {pathTouched && (
              <button
                type="button"
                onClick={() => setPathTouched(false)}
                className="text-[10.5px] text-[#0284c7] hover:underline cursor-pointer"
              >
                Reset auto path
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={targetPath}
              onChange={(e) => {
                setPathTouched(true);
                setTargetPath(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder={
                repo.isWsl ? "/home/user/repo-wt" : "D:\\code\\repo-wt"
              }
              className="flex-1 px-2.5 py-1.5 rounded border border-[#cbd5e1] focus:border-[#0284c7] text-xs font-mono outline-none"
            />
            <button
              type="button"
              onClick={async () => {
                if (repo.isWsl) {
                  const next = !wslBrowserOpen;
                  setWslBrowserOpen(next);
                  if (next) {
                    const parent = repo.linuxPath.replace(/\/[^/]+$/, "") || "/";
                    await loadWslDir(parent);
                  }
                } else {
                  const picked = await GitService.PickFolder(
                    "Select Parent or Target Folder for Worktree"
                  );
                  if (!picked) return;
                  const suffix = sanitizeBranchForFolder(
                    mode === "new-branch"
                      ? newBranchName || "wt"
                      : mode === "existing-branch"
                      ? existingBranch || "wt"
                      : detachRef || "detached"
                  );
                  const sep = picked.includes("\\") ? "\\" : "/";
                  const cleanPicked = picked.replace(/[\\/]+$/, "");
                  setPathTouched(true);
                  setTargetPath(
                    `${cleanPicked}${sep}${repo.name}-${suffix || "wt"}`
                  );
                }
              }}
              className="px-2.5 py-1.5 rounded bg-[#f8fafc] border border-[#cbd5e1] hover:bg-[#f1f5f9] text-xs font-medium text-[#334155] flex items-center gap-1 cursor-pointer shrink-0"
            >
              <FolderOpen className="w-3.5 h-3.5 text-[#0284c7]" />
              Browse...
            </button>
          </div>
          <p className="text-[10.5px] text-[#64748b] mt-1">
            Git will create this directory if it does not exist yet.
          </p>

          {repo.isWsl && wslBrowserOpen && (
            <div className="mt-2 rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-2 flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-[#334155]">
                <span className="truncate">{wslBrowsePath}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      const parent =
                        wslBrowsePath === "/"
                          ? "/"
                          : wslBrowsePath.replace(/\/[^/]+$/, "") || "/";
                      loadWslDir(parent);
                    }}
                    className="px-1.5 py-0.5 rounded bg-white border border-[#cbd5e1] hover:bg-[#f1f5f9] cursor-pointer"
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const suffix = sanitizeBranchForFolder(
                        mode === "new-branch"
                          ? newBranchName || "wt"
                          : mode === "existing-branch"
                          ? existingBranch || "wt"
                          : detachRef || "detached"
                      );
                      const cleanBase = wslBrowsePath.replace(/\/+$/, "");
                      setPathTouched(true);
                      setTargetPath(
                        `${cleanBase}/${repo.name}-${suffix || "wt"}`
                      );
                      setWslBrowserOpen(false);
                    }}
                    className="px-1.5 py-0.5 rounded bg-[#0284c7] text-white cursor-pointer"
                  >
                    Place Here
                  </button>
                </div>
              </div>
              <div className="max-h-32 overflow-y-auto bg-white border border-[#e2e8f0] rounded p-1 flex flex-col gap-0.5">
                {wslLoading ? (
                  <div className="px-2 py-1 text-[11px] text-[#64748b]">
                    Loading...
                  </div>
                ) : wslEntries.length === 0 ? (
                  <div className="px-2 py-1 text-[11px] text-[#94a3b8]">
                    No subdirectories
                  </div>
                ) : (
                  wslEntries.map((entry) => (
                    <button
                      key={entry.path}
                      type="button"
                      onClick={() => loadWslDir(entry.path)}
                      className="flex items-center justify-between px-2 py-1 rounded text-left text-[11px] hover:bg-[#f1f5f9] text-[#334155] cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        <Folder className="w-3.5 h-3.5 text-[#0284c7] shrink-0" />
                        <span className="truncate font-mono">{entry.name}</span>
                      </span>
                      <ChevronRight className="w-3 h-3 text-[#94a3b8] shrink-0" />
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5 pt-0.5">
          <label className="flex items-center gap-2 text-xs text-[#334155] cursor-pointer">
            <input
              type="checkbox"
              checked={openInTab}
              onChange={(e) => setOpenInTab(e.target.checked)}
              className="accent-[#0284c7]"
            />
            Open new worktree in a tab immediately
          </label>
          <label className="flex items-center gap-2 text-xs text-[#64748b] cursor-pointer">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              className="accent-[#d97706]"
            />
            Force (<code className="font-mono">--force</code>)
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="px-3 py-1.5 rounded bg-white border border-[#e2e8f0] hover:bg-[#f8fafc] text-xs font-medium cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="px-3 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-medium disabled:opacity-45 cursor-pointer"
          >
            {busy ? "Creating..." : "Create Worktree"}
          </button>
        </div>
      </div>
    </div>
  );
};

export const LockWorktreeModal: React.FC<{
  worktree: WorktreeInfo | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (wt: WorktreeInfo, reason: string) => void;
}> = ({ worktree, busy = false, onCancel, onConfirm }) => {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (worktree) setReason("");
  }, [worktree]);

  if (!worktree) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#0f172a]/30 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-[#cbd5e1] rounded-xl shadow-xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#0b1c30]">
            <Lock className="w-4 h-4 text-[#d97706]" />
            Lock Worktree
          </div>
          <button
            onClick={onCancel}
            className="text-[#64748b] hover:text-[#0b1c30] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="text-xs text-[#64748b]">
          Locking <code className="px-1 py-0.5 rounded bg-[#f1f5f9] font-mono text-[#0b1c30]">{worktree.name}</code> prevents it from being automatically pruned or accidentally removed.
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-[#475569] mb-1">
            Reason (optional)
          </label>
          <input
            autoFocus
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) onConfirm(worktree, reason);
            }}
            placeholder="e.g. Stored on removable drive / active WIP"
            className="w-full px-2.5 py-1.5 rounded border border-[#cbd5e1] focus:border-[#0284c7] text-xs outline-none"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="px-3 py-1.5 rounded bg-white border border-[#e2e8f0] text-xs font-medium cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onConfirm(worktree, reason)}
            className="px-3 py-1.5 rounded bg-[#d97706] hover:bg-[#b45309] text-white text-xs font-medium disabled:opacity-45 cursor-pointer"
          >
            {busy ? "Locking..." : "Lock Worktree"}
          </button>
        </div>
      </div>
    </div>
  );
};

export const RemoveWorktreeModal: React.FC<{
  worktree: WorktreeInfo | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (wt: WorktreeInfo, force: boolean, unlockFirst: boolean) => void;
}> = ({ worktree, busy = false, onCancel, onConfirm }) => {
  const [force, setForce] = useState(false);
  const [unlockFirst, setUnlockFirst] = useState(true);

  useEffect(() => {
    setForce(false);
    setUnlockFirst(true);
  }, [worktree]);

  if (!worktree) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#0f172a]/30 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-[#cbd5e1] rounded-xl shadow-xl p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-[#fef2f2] text-[#dc2626] flex items-center justify-center shrink-0">
            <Trash2 className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-[#0b1c30]">
              Remove Worktree?
            </h3>
            <p className="text-xs text-[#64748b] mt-1">
              {worktree.isPrunable
                ? "This worktree directory is already missing on disk. Removing it will clean up its Git metadata."
                : "This will unregister the worktree and delete its working directory from disk (commits on its branch remain in the repository):"}
            </p>
            <div className="mt-2 p-2 rounded bg-[#f8fafc] border border-[#e2e8f0] text-[11px] flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-[#0b1c30] truncate">
                  {worktree.name}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-[#e0f2fe] text-[#0369a1] font-mono text-[10px] shrink-0">
                  {worktree.branch ||
                    (worktree.isDetached ? `detached @ ${worktree.headSha}` : worktree.headSha)}
                </span>
              </div>
              <div className="font-mono text-[#64748b] break-all">
                {worktree.rawPath}
              </div>
            </div>

            {worktree.isLocked && (
              <div className="mt-2 p-2 rounded bg-[#fffbeb] border border-[#fde68a] text-[11px] text-[#92400e] flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 font-semibold">
                  <Lock className="w-3.5 h-3.5 text-[#d97706] shrink-0" />
                  <span>
                    Worktree is locked
                    {worktree.lockReason ? `: ${worktree.lockReason}` : ""}
                  </span>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={unlockFirst}
                    onChange={(e) => setUnlockFirst(e.target.checked)}
                    className="accent-[#d97706]"
                  />
                  <span>Unlock worktree before removing</span>
                </label>
              </div>
            )}

            {!worktree.isPrunable && (
              <label className="mt-2.5 flex items-center gap-2 text-xs text-[#334155] cursor-pointer">
                <input
                  type="checkbox"
                  checked={force}
                  onChange={(e) => setForce(e.target.checked)}
                  className="accent-[#dc2626]"
                />
                <span>Force remove even with uncommitted or untracked files</span>
              </label>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="px-3 py-1.5 rounded bg-white border border-[#e2e8f0] hover:bg-[#f8fafc] text-xs font-medium cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || (worktree.isLocked && !unlockFirst)}
            onClick={() => onConfirm(worktree, force, unlockFirst)}
            className="px-3 py-1.5 rounded bg-[#dc2626] hover:bg-[#b91c1c] text-white text-xs font-medium disabled:opacity-45 cursor-pointer"
          >
            {busy ? "Removing..." : "Remove Worktree"}
          </button>
        </div>
      </div>
    </div>
  );
};

export const WorktreeInUseModal: React.FC<{
  info: {
    branchName: string;
    worktree: WorktreeInfo | null;
    errorMessage: string;
  } | null;
  onCancel: () => void;
  onSwitchToWorktree: (wt: WorktreeInfo) => void;
}> = ({ info, onCancel, onSwitchToWorktree }) => {
  if (!info) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#0f172a]/30 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-[#cbd5e1] rounded-xl shadow-xl p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-[#e0f2fe] text-[#0284c7] flex items-center justify-center shrink-0">
            <GitBranch className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-[#0b1c30]">
              Branch Already Checked Out in Another Worktree
            </h3>
            <p className="text-xs text-[#64748b] mt-1">
              Git allows a branch to be checked out in only one worktree at a time.{" "}
              <code className="px-1 py-0.5 rounded bg-[#f1f5f9] font-mono text-[#0b1c30]">
                {info.branchName}
              </code>{" "}
              is currently active in:
            </p>
            {info.worktree ? (
              <div className="mt-2 p-2 rounded bg-[#f8fafc] border border-[#e2e8f0] text-[11px] flex flex-col gap-0.5">
                <div className="font-semibold text-[#0b1c30]">
                  {info.worktree.name}
                </div>
                <div className="font-mono text-[#64748b] break-all">
                  {info.worktree.rawPath}
                </div>
              </div>
            ) : (
              <pre className="mt-2 p-2 rounded bg-[#fef2f2] border border-[#fecaca] text-[10px] font-mono text-[#991b1b] whitespace-pre-wrap max-h-24 overflow-y-auto">
                {info.errorMessage}
              </pre>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded bg-white border border-[#e2e8f0] hover:bg-[#f8fafc] text-xs font-medium cursor-pointer"
          >
            Close
          </button>
          {info.worktree && (
            <button
              type="button"
              onClick={() => onSwitchToWorktree(info.worktree!)}
              className="px-3 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-medium cursor-pointer flex items-center gap-1.5"
            >
              <FolderTree className="w-3.5 h-3.5" />
              Open Worktree Tab
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
