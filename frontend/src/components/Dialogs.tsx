import React, { useState } from "react";
import {
  AlertTriangle,
  GitBranch,
  Archive,
  Tag as TagIcon,
  Trash2,
  Pencil,
  CloudOff,
  RotateCcw,
  History,
  X,
} from "lucide-react";
import type {
  CommitItem,
  FileStatus,
  RemoteInfo,
  TagInfo,
} from "../../bindings/gitpulse/internal/git/models";

export const DiscardConfirmModal: React.FC<{
  files: FileStatus[];
  onCancel: () => void;
  onConfirm: (files: FileStatus[]) => void;
}> = ({ files, onCancel, onConfirm }) => {
  if (!files || files.length === 0) return null;
  const single = files.length === 1 ? files[0] : null;
  const isSingleUntracked = single?.status === "?";
  const hasUntracked = files.some((f) => f.status === "?");
  return (
    <div className="fixed inset-0 z-50 bg-[#0f172a]/30 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-[#cbd5e1] rounded-xl shadow-xl p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-[#fef2f2] text-[#dc2626] flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-[#0b1c30]">
              {single
                ? isSingleUntracked
                  ? "Delete Untracked File?"
                  : "Discard Working Changes?"
                : `Discard ${files.length} Selected Files?`}
            </h3>
            <p className="text-xs text-[#64748b] mt-1">
              {single
                ? isSingleUntracked
                  ? "This untracked file will be permanently deleted from disk:"
                  : "All unstaged changes in this file will be permanently lost:"
                : hasUntracked
                ? "Unstaged changes will be discarded and untracked files among the selection will be permanently deleted:"
                : "All unstaged changes in the selected files will be permanently lost:"}
            </p>
            <div className="mt-2 px-2 py-1.5 rounded bg-[#f8fafc] border border-[#e2e8f0] font-mono text-[11px] text-[#0b1c30] max-h-36 overflow-y-auto flex flex-col gap-0.5">
              {files.map((f) => (
                <div key={f.path} className="break-all">
                  {f.path}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded bg-white border border-[#e2e8f0] hover:bg-[#f8fafc] text-xs font-medium text-[#334155] cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(files)}
            className="px-3 py-1.5 rounded bg-[#dc2626] hover:bg-[#b91c1c] text-white text-xs font-medium cursor-pointer"
          >
            {single
              ? isSingleUntracked
                ? "Delete File"
                : "Discard Changes"
              : `Discard ${files.length} Files`}
          </button>
        </div>
      </div>
    </div>
  );
};

export const CreateBranchModal: React.FC<{
  open: boolean;
  startPoint: string;
  defaultCheckout?: boolean;
  onCancel: () => void;
  onConfirm: (name: string, startPoint: string, checkout: boolean) => void;
}> = ({ open, startPoint, defaultCheckout = true, onCancel, onConfirm }) => {
  const [name, setName] = useState("");
  const [base, setBase] = useState(startPoint);
  const [checkout, setCheckout] = useState(defaultCheckout);

  React.useEffect(() => {
    if (open) {
      setName("");
      setBase(startPoint);
      setCheckout(defaultCheckout);
    }
  }, [open, startPoint, defaultCheckout]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#0f172a]/30 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-[#cbd5e1] rounded-xl shadow-xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#0b1c30]">
            <GitBranch className="w-4 h-4 text-[#0284c7]" />
            {checkout ? "Create & Checkout Branch" : "Create New Branch"}
          </div>
          <button onClick={onCancel} className="text-[#64748b] hover:text-[#0b1c30] cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-[#475569] mb-1">
            Branch Name
          </label>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) onConfirm(name, base, checkout);
            }}
            placeholder="feat/my-feature"
            className="w-full px-2.5 py-1.5 rounded border border-[#cbd5e1] focus:border-[#0284c7] text-xs font-mono outline-none"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-[#475569] mb-1">
            Base Commit / Branch (blank = HEAD)
          </label>
          <input
            type="text"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            placeholder="HEAD"
            className="w-full px-2.5 py-1.5 rounded border border-[#cbd5e1] focus:border-[#0284c7] text-xs font-mono outline-none"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-[#334155] cursor-pointer">
          <input
            type="checkbox"
            checked={checkout}
            onChange={(e) => setCheckout(e.target.checked)}
            className="accent-[#0284c7]"
          />
          Checkout branch after creation
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded bg-white border border-[#e2e8f0] text-xs font-medium cursor-pointer"
          >
            Cancel
          </button>
          <button
            disabled={!name.trim()}
            onClick={() => onConfirm(name, base, checkout)}
            className="px-3 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-medium disabled:opacity-45 cursor-pointer"
          >
            {checkout ? "Create & Checkout" : "Create Branch"}
          </button>
        </div>
      </div>
    </div>
  );
};

export const RenameBranchModal: React.FC<{
  branchName: string | null;
  onCancel: () => void;
  onConfirm: (oldName: string, newName: string) => void;
}> = ({ branchName, onCancel, onConfirm }) => {
  const [newName, setNewName] = useState("");
  React.useEffect(() => {
    if (branchName) setNewName(branchName);
  }, [branchName]);

  if (!branchName) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#0f172a]/30 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-[#cbd5e1] rounded-xl shadow-xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#0b1c30]">
            <Pencil className="w-4 h-4 text-[#0284c7]" />
            Rename Branch
          </div>
          <button onClick={onCancel} className="text-[#64748b] hover:text-[#0b1c30] cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="text-xs text-[#64748b]">
          Renaming local branch <code className="px-1 py-0.5 rounded bg-[#f1f5f9] font-mono text-[#0b1c30]">{branchName}</code>
        </div>
        <input
          autoFocus
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newName.trim() && newName.trim() !== branchName) {
              onConfirm(branchName, newName.trim());
            }
          }}
          className="w-full px-2.5 py-1.5 rounded border border-[#cbd5e1] focus:border-[#0284c7] text-xs font-mono outline-none"
        />
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded bg-white border border-[#e2e8f0] text-xs font-medium cursor-pointer"
          >
            Cancel
          </button>
          <button
            disabled={!newName.trim() || newName.trim() === branchName}
            onClick={() => onConfirm(branchName, newName.trim())}
            className="px-3 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-medium disabled:opacity-45 cursor-pointer"
          >
            Rename Branch
          </button>
        </div>
      </div>
    </div>
  );
};

export const DeleteBranchModal: React.FC<{
  branchName: string | null;
  onCancel: () => void;
  onConfirm: (name: string, force: boolean) => void;
}> = ({ branchName, onCancel, onConfirm }) => {
  const [force, setForce] = useState(false);
  React.useEffect(() => {
    setForce(false);
  }, [branchName]);

  if (!branchName) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#0f172a]/30 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-[#cbd5e1] rounded-xl shadow-xl p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#0b1c30]">
          <Trash2 className="w-4 h-4 text-[#dc2626]" />
          Delete Local Branch
        </div>
        <p className="text-xs text-[#475569]">
          Delete local branch <code className="px-1 py-0.5 rounded bg-[#f1f5f9] font-mono text-[#0b1c30]">{branchName}</code>?
        </p>
        <label className="flex items-center gap-2 text-xs text-[#dc2626] cursor-pointer">
          <input
            type="checkbox"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            className="accent-[#dc2626]"
          />
          Force delete (-D) even if not fully merged
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded bg-white border border-[#e2e8f0] text-xs font-medium cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(branchName, force)}
            className="px-3 py-1.5 rounded bg-[#dc2626] hover:bg-[#b91c1c] text-white text-xs font-medium cursor-pointer"
          >
            Delete ({force ? "-D" : "-d"})
          </button>
        </div>
      </div>
    </div>
  );
};

export const DeleteRemoteBranchModal: React.FC<{
  remoteBranch: string | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (remoteBranch: string) => void;
}> = ({ remoteBranch, busy, onCancel, onConfirm }) => {
  if (!remoteBranch) return null;
  return (
    <div className="fixed inset-0 z-50 bg-[#0f172a]/30 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-[#cbd5e1] rounded-xl shadow-xl p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-[#fef2f2] text-[#dc2626] flex items-center justify-center shrink-0">
            <CloudOff className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[#0b1c30]">
              Delete Remote Branch?
            </h3>
            <p className="text-xs text-[#64748b] mt-1">
              This will permanently delete the branch on the remote server (
              <code className="font-mono">git push --delete</code>) and affect other collaborators:
            </p>
            <div className="mt-2 px-2 py-1 rounded bg-[#fef2f2] border border-[#fecaca] font-mono text-[11px] text-[#991b1b] break-all">
              {remoteBranch}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded bg-white border border-[#e2e8f0] hover:bg-[#f8fafc] text-xs font-medium text-[#334155] cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(remoteBranch)}
            disabled={busy}
            className="px-3 py-1.5 rounded bg-[#dc2626] hover:bg-[#b91c1c] text-white text-xs font-medium disabled:opacity-50 cursor-pointer"
          >
            {busy ? "Deleting..." : "Confirm Delete Remote"}
          </button>
        </div>
      </div>
    </div>
  );
};

export const CheckoutConflictModal: React.FC<{
  target: {
    name: string;
    isRemote: boolean;
    kind?: "branch" | "tag";
    errorMessage: string;
  } | null;
  onCancel: () => void;
  onStashAndCheckout: (
    name: string,
    isRemote: boolean,
    kind?: "branch" | "tag"
  ) => void;
  onGoToChanges: () => void;
}> = ({ target, onCancel, onStashAndCheckout, onGoToChanges }) => {
  if (!target) return null;
  const isTag = target.kind === "tag";
  return (
    <div className="fixed inset-0 z-50 bg-[#0f172a]/30 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white border border-[#cbd5e1] rounded-xl shadow-xl p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-[#fef3c7] text-[#d97706] flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#0b1c30]">
              Cannot Checkout {isTag ? "Tag " : ""}"{target.name}"
            </h3>
            <p className="text-xs text-[#64748b] mt-1">
              Your local uncommitted changes would be overwritten by checkout. Please Stash or Commit them first.
            </p>
            <pre className="mt-2 p-2 rounded bg-[#f8fafc] border border-[#e2e8f0] text-[11px] font-mono text-[#dc2626] whitespace-pre-wrap max-h-32 overflow-y-auto">
              {target.errorMessage}
            </pre>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded bg-white border border-[#e2e8f0] text-xs font-medium cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onGoToChanges}
            className="px-3 py-1.5 rounded bg-white border border-[#cbd5e1] hover:bg-[#f8fafc] text-xs font-medium text-[#0b1c30] cursor-pointer"
          >
            Review Changes to Commit
          </button>
          <button
            onClick={() => onStashAndCheckout(target.name, target.isRemote, target.kind)}
            className="px-3 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-medium cursor-pointer"
          >
            {isTag ? "Stash & Checkout Tag" : "Stash & Switch Branch"}
          </button>
        </div>
      </div>
    </div>
  );
};

export const StashModal: React.FC<{
  open: boolean;
  onCancel: () => void;
  onConfirm: (message: string, includeUntracked: boolean) => void;
}> = ({ open, onCancel, onConfirm }) => {
  const [msg, setMsg] = useState("");
  const [untracked, setUntracked] = useState(true);
  React.useEffect(() => {
    if (open) {
      setMsg("");
      setUntracked(true);
    }
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-[#0f172a]/30 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-[#cbd5e1] rounded-xl shadow-xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#0b1c30]">
            <Archive className="w-4 h-4 text-[#d97706]" />
            Stash Working Tree Changes
          </div>
          <button onClick={onCancel} className="text-[#64748b] cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-[#475569] mb-1">
            Stash Message (optional)
          </label>
          <input
            autoFocus
            type="text"
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onConfirm(msg, untracked);
            }}
            placeholder="WIP: work in progress..."
            className="w-full px-2.5 py-1.5 rounded border border-[#cbd5e1] focus:border-[#0284c7] text-xs outline-none"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-[#334155] cursor-pointer">
          <input
            type="checkbox"
            checked={untracked}
            onChange={(e) => setUntracked(e.target.checked)}
            className="accent-[#0284c7]"
          />
          Include untracked files (-u)
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded bg-white border border-[#e2e8f0] text-xs font-medium cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(msg, untracked)}
            className="px-3 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-medium cursor-pointer"
          >
            Stash Changes
          </button>
        </div>
      </div>
    </div>
  );
};

export const CreateTagModal: React.FC<{
  open: boolean;
  target: string;
  onCancel: () => void;
  onConfirm: (name: string, target: string, message: string) => void;
}> = ({ open, target, onCancel, onConfirm }) => {
  const [name, setName] = useState("");
  const [tagTarget, setTagTarget] = useState(target);
  const [msg, setMsg] = useState("");
  React.useEffect(() => {
    if (open) {
      setName("");
      setTagTarget(target);
      setMsg("");
    }
  }, [open, target]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-[#0f172a]/30 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-[#cbd5e1] rounded-xl shadow-xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#0b1c30]">
            <TagIcon className="w-4 h-4 text-[#16a34a]" />
            Create Tag
          </div>
          <button onClick={onCancel} className="text-[#64748b] cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-[#475569] mb-1">
            Tag Name
          </label>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) onConfirm(name, tagTarget, msg);
            }}
            placeholder="v1.0.0"
            className="w-full px-2.5 py-1.5 rounded border border-[#cbd5e1] focus:border-[#0284c7] text-xs font-mono outline-none"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-[#475569] mb-1">
            Target Branch / Commit (blank = HEAD)
          </label>
          <input
            type="text"
            value={tagTarget}
            onChange={(e) => setTagTarget(e.target.value)}
            placeholder="HEAD"
            className="w-full px-2.5 py-1.5 rounded border border-[#cbd5e1] focus:border-[#0284c7] text-xs font-mono outline-none"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-[#475569] mb-1">
            Message (optional, creates annotated tag)
          </label>
          <input
            type="text"
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            placeholder="Release notes..."
            className="w-full px-2.5 py-1.5 rounded border border-[#cbd5e1] focus:border-[#0284c7] text-xs outline-none"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded bg-white border border-[#e2e8f0] text-xs font-medium cursor-pointer"
          >
            Cancel
          </button>
          <button
            disabled={!name.trim()}
            onClick={() => onConfirm(name, tagTarget, msg)}
            className="px-3 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-medium disabled:opacity-45 cursor-pointer"
          >
            Create Tag
          </button>
        </div>
      </div>
    </div>
  );
};

export const RevertCommitModal: React.FC<{
  commit: CommitItem | null;
  onCancel: () => void;
  onConfirm: (commit: CommitItem) => void;
}> = ({ commit, onCancel, onConfirm }) => {
  if (!commit) return null;
  return (
    <div className="fixed inset-0 z-50 bg-[#0f172a]/30 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-[#cbd5e1] rounded-xl shadow-xl p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-[#f0f9ff] text-[#0284c7] flex items-center justify-center shrink-0">
            <RotateCcw className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[#0b1c30]">
              Revert Commit?
            </h3>
            <p className="text-xs text-[#64748b] mt-1">
              Creates a new commit that inverses the changes introduced by:
            </p>
            <div className="mt-2 p-2 rounded bg-[#f8fafc] border border-[#e2e8f0] text-xs">
              <span className="font-mono text-[#0284c7] font-semibold mr-2">
                {commit.shortHash}
              </span>
              <span className="text-[#0b1c30] font-medium break-words">
                {commit.subject}
              </span>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded bg-white border border-[#e2e8f0] text-xs font-medium cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(commit)}
            className="px-3 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-medium cursor-pointer"
          >
            Revert Commit
          </button>
        </div>
      </div>
    </div>
  );
};

export const ResetCommitModal: React.FC<{
  commit: CommitItem | null;
  currentBranch: string;
  onCancel: () => void;
  onConfirm: (commit: CommitItem, mode: "soft" | "mixed" | "hard") => void;
}> = ({ commit, currentBranch, onCancel, onConfirm }) => {
  const [mode, setMode] = useState<"soft" | "mixed" | "hard">("mixed");
  React.useEffect(() => {
    setMode("mixed");
  }, [commit?.hash]);

  if (!commit) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#0f172a]/30 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-[#cbd5e1] rounded-xl shadow-xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#0b1c30]">
            <History className="w-4 h-4 text-[#d97706]" />
            Reset Branch "{currentBranch || "HEAD"}"
          </div>
          <button onClick={onCancel} className="text-[#64748b] cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-2 rounded bg-[#f8fafc] border border-[#e2e8f0] text-xs">
          <span className="font-mono text-[#0284c7] font-semibold mr-2">
            {commit.shortHash}
          </span>
          <span className="text-[#0b1c30] font-medium break-words">
            {commit.subject}
          </span>
        </div>

        <div className="flex flex-col gap-1.5 text-xs">
          {[
            {
              id: "soft" as const,
              title: "Soft (--soft)",
              desc: "Move HEAD only. Keep all changes staged in index.",
            },
            {
              id: "mixed" as const,
              title: "Mixed (--mixed)",
              desc: "Move HEAD and reset index. Keep changes in working tree.",
            },
            {
              id: "hard" as const,
              title: "Hard (--hard)",
              desc: "Move HEAD and discard all staged & working tree changes.",
            },
          ].map((opt) => (
            <label
              key={opt.id}
              className={`flex items-start gap-2 p-2 rounded border cursor-pointer transition-colors ${
                mode === opt.id
                  ? opt.id === "hard"
                    ? "bg-[#fef2f2] border-[#fca5a5]"
                    : "bg-[#f0f9ff] border-[#bae6fd]"
                  : "bg-white border-[#e2e8f0] hover:bg-[#f8fafc]"
              }`}
            >
              <input
                type="radio"
                name="resetMode"
                checked={mode === opt.id}
                onChange={() => setMode(opt.id)}
                className="mt-0.5 accent-[#0284c7]"
              />
              <div>
                <div
                  className={`font-semibold ${
                    opt.id === "hard" ? "text-[#dc2626]" : "text-[#0b1c30]"
                  }`}
                >
                  {opt.title}
                </div>
                <div className="text-[11px] text-[#64748b]">{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded bg-white border border-[#e2e8f0] text-xs font-medium cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(commit, mode)}
            className={`px-3 py-1.5 rounded text-white text-xs font-medium cursor-pointer ${
              mode === "hard"
                ? "bg-[#dc2626] hover:bg-[#b91c1c]"
                : "bg-[#0284c7] hover:bg-[#0369a1]"
            }`}
          >
            Reset (--{mode})
          </button>
        </div>
      </div>
    </div>
  );
};

function pickDefaultRemote(remotes: RemoteInfo[]): string {
  const origin = remotes.find((r) => r.name === "origin");
  return origin ? origin.name : remotes[0]?.name || "origin";
}

export const DeleteTagModal: React.FC<{
  tag: TagInfo | null;
  remotes: RemoteInfo[];
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (tagName: string, alsoRemote: boolean, remoteName: string) => void;
}> = ({ tag, remotes, busy, onCancel, onConfirm }) => {
  const [alsoRemote, setAlsoRemote] = useState(false);
  const [remoteName, setRemoteName] = useState("origin");

  React.useEffect(() => {
    setAlsoRemote(false);
    setRemoteName(pickDefaultRemote(remotes));
  }, [tag?.name, remotes]);

  if (!tag) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#0f172a]/30 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-[#cbd5e1] rounded-xl shadow-xl p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-[#fef2f2] text-[#dc2626] flex items-center justify-center shrink-0">
            <Trash2 className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-[#0b1c30]">
              Delete Local Tag
            </h3>
            <p className="text-xs text-[#64748b] mt-1">
              Delete local tag{" "}
              <code className="px-1 py-0.5 rounded bg-[#f1f5f9] font-mono text-[#0b1c30]">
                {tag.name}
              </code>{" "}
              (<span className="font-mono">{tag.hash}</span>)?
            </p>
            {tag.message && (
              <div className="mt-2 px-2 py-1 rounded bg-[#f8fafc] border border-[#e2e8f0] text-[11px] text-[#475569] truncate">
                {tag.message}
              </div>
            )}
          </div>
        </div>

        {remotes.length > 0 && (
          <div className="flex flex-col gap-2 pt-1 border-t border-[#f1f5f9]">
            <label className="flex items-center gap-2 text-xs text-[#dc2626] cursor-pointer">
              <input
                type="checkbox"
                checked={alsoRemote}
                onChange={(e) => setAlsoRemote(e.target.checked)}
                className="accent-[#dc2626]"
              />
              Also delete tag from remote
            </label>
            {alsoRemote && (
              <div className="flex items-center gap-2 pl-5">
                <span className="text-[11px] text-[#64748b]">Remote:</span>
                <select
                  value={remoteName}
                  onChange={(e) => setRemoteName(e.target.value)}
                  className="px-2 py-1 rounded bg-white border border-[#cbd5e1] text-xs font-mono outline-none"
                >
                  {remotes.map((r) => (
                    <option key={r.name} value={r.name}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded bg-white border border-[#e2e8f0] text-xs font-medium cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(tag.name, alsoRemote, remoteName)}
            disabled={busy}
            className="px-3 py-1.5 rounded bg-[#dc2626] hover:bg-[#b91c1c] text-white text-xs font-medium disabled:opacity-50 cursor-pointer"
          >
            {busy
              ? "Deleting..."
              : alsoRemote
              ? `Delete Local & ${remoteName}`
              : "Delete Tag"}
          </button>
        </div>
      </div>
    </div>
  );
};

export const DeleteRemoteTagModal: React.FC<{
  tag: TagInfo | null;
  remotes: RemoteInfo[];
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (tagName: string, remoteName: string) => void;
}> = ({ tag, remotes, busy, onCancel, onConfirm }) => {
  const [remoteName, setRemoteName] = useState("origin");

  React.useEffect(() => {
    setRemoteName(pickDefaultRemote(remotes));
  }, [tag?.name, remotes]);

  if (!tag) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#0f172a]/30 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-[#cbd5e1] rounded-xl shadow-xl p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-[#fef2f2] text-[#dc2626] flex items-center justify-center shrink-0">
            <CloudOff className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-[#0b1c30]">
              Delete Remote Tag?
            </h3>
            <p className="text-xs text-[#64748b] mt-1">
              This removes the tag on the remote repository (
              <code className="font-mono">git push --delete refs/tags/...</code>
              ), keeping your local tag intact.
            </p>
            <div className="mt-2 px-2 py-1 rounded bg-[#fef2f2] border border-[#fecaca] font-mono text-[11px] text-[#991b1b] break-all">
              {remoteName} / refs/tags/{tag.name}
            </div>
            {remotes.length > 1 && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[11px] text-[#64748b]">Remote:</span>
                <select
                  value={remoteName}
                  onChange={(e) => setRemoteName(e.target.value)}
                  className="px-2 py-1 rounded bg-white border border-[#cbd5e1] text-xs font-mono outline-none"
                >
                  {remotes.map((r) => (
                    <option key={r.name} value={r.name}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded bg-white border border-[#e2e8f0] hover:bg-[#f8fafc] text-xs font-medium text-[#334155] cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(tag.name, remoteName)}
            disabled={busy}
            className="px-3 py-1.5 rounded bg-[#dc2626] hover:bg-[#b91c1c] text-white text-xs font-medium disabled:opacity-50 cursor-pointer"
          >
            {busy ? "Deleting..." : "Confirm Delete Remote Tag"}
          </button>
        </div>
      </div>
    </div>
  );
};

export const PushTagModal: React.FC<{
  tag: TagInfo | null;
  remotes: RemoteInfo[];
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (tagName: string, remoteName: string) => void;
}> = ({ tag, remotes, busy, onCancel, onConfirm }) => {
  const [remoteName, setRemoteName] = useState("origin");

  React.useEffect(() => {
    setRemoteName(pickDefaultRemote(remotes));
  }, [tag?.name, remotes]);

  if (!tag) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#0f172a]/30 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-[#cbd5e1] rounded-xl shadow-xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#0b1c30]">
            <TagIcon className="w-4 h-4 text-[#16a34a]" />
            Push Tag to Remote
          </div>
          <button onClick={onCancel} className="text-[#64748b] cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="text-xs text-[#475569]">
          Push tag{" "}
          <code className="px-1 py-0.5 rounded bg-[#f0fdf4] border border-[#bbf7d0] font-mono text-[#15803d]">
            {tag.name}
          </code>{" "}
          to remote:
        </div>
        <select
          value={remoteName}
          onChange={(e) => setRemoteName(e.target.value)}
          className="w-full px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-xs font-mono outline-none"
        >
          {remotes.map((r) => (
            <option key={r.name} value={r.name}>
              {r.name} ({r.pushUrl || r.fetchUrl})
            </option>
          ))}
        </select>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded bg-white border border-[#e2e8f0] text-xs font-medium cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(tag.name, remoteName)}
            disabled={busy}
            className="px-3 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-medium disabled:opacity-50 cursor-pointer"
          >
            {busy ? "Pushing..." : `Push to ${remoteName}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export const ConfirmDangerModal: React.FC<{
  open: boolean;
  title: string;
  description: string;
  detail?: string;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({
  open,
  title,
  description,
  detail,
  confirmLabel = "Confirm Delete",
  busy,
  onCancel,
  onConfirm,
}) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-[#0f172a]/30 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-[#cbd5e1] rounded-xl shadow-xl p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-[#fef2f2] text-[#dc2626] flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-[#0b1c30]">{title}</h3>
            <p className="text-xs text-[#64748b] mt-1 leading-relaxed">
              {description}
            </p>
            {detail && (
              <div className="mt-2 px-2 py-1.5 rounded bg-[#fef2f2] border border-[#fecaca] font-mono text-[11px] text-[#991b1b] break-all max-h-28 overflow-y-auto">
                {detail}
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded bg-white border border-[#e2e8f0] hover:bg-[#f8fafc] text-xs font-medium text-[#334155] cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="px-3 py-1.5 rounded bg-[#dc2626] hover:bg-[#b91c1c] text-white text-xs font-medium disabled:opacity-50 cursor-pointer"
          >
            {busy ? "Processing..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
