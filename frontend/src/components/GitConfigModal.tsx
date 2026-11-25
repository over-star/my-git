import React, { useEffect, useState } from "react";
import {
  Settings,
  User,
  Globe,
  FolderGit2,
  TerminalSquare,
  X,
  Save,
  RotateCcw,
} from "lucide-react";
import type {
  GitConfigBundle,
  RepoLocation,
  WSLDistro,
} from "../../bindings/gitpulse/internal/git/models";
import { GitService } from "../../bindings/gitpulse";

interface GitConfigModalProps {
  open: boolean;
  repo: RepoLocation | null;
  initialScope?: "local" | "global";
  onClose: () => void;
  onSaved: (msg: string) => void;
  onNotify: (type: "success" | "error" | "info", msg: string) => void;
}

export const GitConfigModal: React.FC<GitConfigModalProps> = ({
  open,
  repo,
  initialScope,
  onClose,
  onSaved,
  onNotify,
}) => {
  const [scope, setScope] = useState<"local" | "global">("local");
  const [distros, setDistros] = useState<WSLDistro[]>([]);
  const [globalDistro, setGlobalDistro] = useState<string>(""); // "" = Windows Local
  const [bundle, setBundle] = useState<GitConfigBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("");
  const [autoCrlf, setAutoCrlf] = useState("");
  const [pullRebase, setPullRebase] = useState("");
  const [gpgSign, setGpgSign] = useState("");
  const [signingKey, setSigningKey] = useState("");

  useEffect(() => {
    if (!open) return;
    const defaultScope = repo
      ? initialScope ?? "local"
      : "global";
    setScope(defaultScope);
    // If active repo is WSL2, default global config environment to that WSL2 distro
    setGlobalDistro(repo?.isWsl ? repo.distro : "");

    GitService.ListWSLDistros()
      .then((list) => setDistros(list ?? []))
      .catch(() => setDistros([]));
  }, [open, repo?.path, initialScope]);

  const loadConfig = async (
    targetScope: "local" | "global",
    distroForGlobal: string
  ) => {
    setLoading(true);
    try {
      const b = await GitService.GetGitConfig(
        repo?.path ?? "",
        targetScope === "global" ? distroForGlobal : repo?.isWsl ? repo.distro : ""
      );
      setBundle(b);
      const src = targetScope === "local" ? b.local : b.global;
      setUserName(src.userName ?? "");
      setUserEmail(src.userEmail ?? "");
      setDefaultBranch(src.defaultBranch ?? "");
      setAutoCrlf(src.autoCrlf ?? "");
      setPullRebase(src.pullRebase ?? "");
      setGpgSign(src.gpgSign ?? "");
      setSigningKey(src.signingKey ?? "");
    } catch (err) {
      onNotify("error", `Failed to load Git config: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    loadConfig(scope, globalDistro);
  }, [open, scope, globalDistro, repo?.path]);

  if (!open) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await GitService.SaveGitConfig({
        repoPath: repo?.path ?? "",
        scope,
        distro: scope === "global" ? globalDistro : "",
        userName,
        userEmail,
        defaultBranch,
        autoCrlf,
        pullRebase,
        gpgSign,
        signingKey,
      });
      if (res.success) {
        onSaved(res.message);
        onClose();
      } else {
        onNotify("error", res.message || "Failed to save Git config");
      }
    } catch (err) {
      onNotify("error", String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleClearLocal = async () => {
    setUserName("");
    setUserEmail("");
    setAutoCrlf("");
    setPullRebase("");
    setGpgSign("");
    setSigningKey("");
  };

  const isWSLActive =
    (scope === "local" && Boolean(repo?.isWsl)) ||
    (scope === "global" && globalDistro !== "");
  const activeDistroName =
    scope === "local" ? repo?.distro : globalDistro;

  return (
    <div className="fixed inset-0 z-50 bg-[#0f172a]/30 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-white border border-[#cbd5e1] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="px-4 py-3 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-[#0284c7] text-white flex items-center justify-center">
              <Settings className="w-3.5 h-3.5" />
            </div>
            <div>
              <h2 className="text-[13px] font-semibold text-[#0b1c30]">
                Git Configuration
              </h2>
              <p className="text-[11px] text-[#64748b]">
                Configure author identity and Git options for this repository or globally (Windows / WSL2)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[#e2e8f0] text-[#64748b] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scope Tabs */}
        <div className="px-4 pt-2 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between">
          <div className="flex items-center gap-1">
            {repo && (
              <button
                onClick={() => setScope("local")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-md text-[12px] font-medium border-b-2 transition-colors cursor-pointer ${
                  scope === "local"
                    ? "bg-white border-[#0284c7] text-[#0284c7]"
                    : "border-transparent text-[#64748b] hover:text-[#0b1c30]"
                }`}
              >
                <FolderGit2 className="w-3.5 h-3.5" />
                <span>Repository ({repo.name})</span>
              </button>
            )}
            <button
              onClick={() => setScope("global")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-md text-[12px] font-medium border-b-2 transition-colors cursor-pointer ${
                scope === "global"
                  ? "bg-white border-[#0284c7] text-[#0284c7]"
                  : "border-transparent text-[#64748b] hover:text-[#0b1c30]"
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Global (--global)</span>
            </button>
          </div>

          {scope === "global" && (
            <div className="flex items-center gap-1.5 pb-1.5">
              <TerminalSquare className="w-3.5 h-3.5 text-[#64748b]" />
              <select
                value={globalDistro}
                onChange={(e) => setGlobalDistro(e.target.value)}
                className="px-2 py-1 rounded bg-white border border-[#cbd5e1] text-[11px] font-medium text-[#0b1c30] outline-none focus:border-[#0284c7]"
              >
                <option value="">Windows Local Git</option>
                {distros.map((d) => (
                  <option key={d.name} value={d.name}>
                    WSL2 · {d.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto flex flex-col gap-3">
          {/* Environment Context Banner */}
          <div
            className={`px-3 py-2 rounded-lg border text-[11px] flex items-center justify-between ${
              isWSLActive
                ? "bg-[#faf5ff] border-[#ddd6fe] text-[#5b21b6]"
                : "bg-[#f0f9ff] border-[#bae6fd] text-[#0369a1]"
            }`}
          >
            <span>
              {scope === "local" ? (
                <>
                  Editing <strong>--local</strong> config for{" "}
                  <code className="font-mono">{repo?.name}</code>{" "}
                  {repo?.isWsl ? `(WSL2 · ${repo.distro})` : "(Windows)"}
                </>
              ) : isWSLActive ? (
                <>
                  Editing <strong>--global</strong> config inside WSL2{" "}
                  <code className="font-mono">{activeDistroName}</code> (~/.gitconfig)
                </>
              ) : (
                <>
                  Editing <strong>--global</strong> config on Windows (~/.gitconfig)
                </>
              )}
            </span>
            {scope === "local" && (
              <button
                type="button"
                onClick={handleClearLocal}
                className="flex items-center gap-1 text-[10px] underline hover:opacity-80 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                Clear local overrides
              </button>
            )}
          </div>

          {loading ? (
            <div className="py-10 text-center text-xs text-[#64748b]">
              Loading Git configuration...
            </div>
          ) : (
            <>
              {/* Author Identity */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="flex items-center gap-1 text-[11px] font-semibold text-[#475569] mb-1">
                    <User className="w-3 h-3" />
                    user.name
                  </label>
                  <input
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder={
                      scope === "local" && bundle?.global.userName
                        ? `Inherit global (${bundle.global.userName})`
                        : "Your Name"
                    }
                    className="w-full px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-xs outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#475569] mb-1">
                    user.email
                  </label>
                  <input
                    type="email"
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    placeholder={
                      scope === "local" && bundle?.global.userEmail
                        ? `Inherit global (${bundle.global.userEmail})`
                        : "you@example.com"
                    }
                    className="w-full px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-xs outline-none"
                  />
                </div>
              </div>

              {/* Behavior Settings */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[#475569] mb-1">
                    core.autocrlf
                  </label>
                  <select
                    value={autoCrlf}
                    onChange={(e) => setAutoCrlf(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-xs outline-none"
                  >
                    <option value="">
                      {scope === "local" ? "Inherit global" : "Unset (Git default)"}
                    </option>
                    <option value="true">true (Windows CRLF checkout)</option>
                    <option value="input">input (LF on commit, recommended WSL2)</option>
                    <option value="false">false (No conversion)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#475569] mb-1">
                    pull.rebase
                  </label>
                  <select
                    value={pullRebase}
                    onChange={(e) => setPullRebase(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-xs outline-none"
                  >
                    <option value="">
                      {scope === "local" ? "Inherit global" : "Unset (Git default)"}
                    </option>
                    <option value="false">false (Merge on pull)</option>
                    <option value="true">true (Rebase on pull)</option>
                  </select>
                </div>
              </div>

              {scope === "global" && (
                <div>
                  <label className="block text-[11px] font-semibold text-[#475569] mb-1">
                    init.defaultBranch
                  </label>
                  <input
                    type="text"
                    value={defaultBranch}
                    onChange={(e) => setDefaultBranch(e.target.value)}
                    placeholder="main"
                    className="w-full px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-xs font-mono outline-none"
                  />
                </div>
              )}

              {/* GPG Signing */}
              <div className="grid grid-cols-2 gap-3 pt-1 border-t border-[#f1f5f9]">
                <div>
                  <label className="block text-[11px] font-semibold text-[#475569] mb-1">
                    commit.gpgsign
                  </label>
                  <select
                    value={gpgSign}
                    onChange={(e) => setGpgSign(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-xs outline-none"
                  >
                    <option value="">
                      {scope === "local" ? "Inherit global" : "Unset (false)"}
                    </option>
                    <option value="true">true (Sign commits)</option>
                    <option value="false">false</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#475569] mb-1">
                    user.signingkey
                  </label>
                  <input
                    type="text"
                    value={signingKey}
                    onChange={(e) => setSigningKey(e.target.value)}
                    placeholder="Optional GPG/SSH key ID"
                    className="w-full px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-xs font-mono outline-none"
                  />
                </div>
              </div>

              {/* Effective Summary */}
              {bundle && (
                <div className="px-3 py-2 rounded bg-[#f8fafc] border border-[#e2e8f0] text-[11px] text-[#64748b] flex items-center justify-between">
                  <span>
                    Effective Identity:{" "}
                    <strong className="text-[#0b1c30]">
                      {bundle.effective.userName || "(unset)"}{" "}
                      {bundle.effective.userEmail
                        ? `<${bundle.effective.userEmail}>`
                        : ""}
                    </strong>
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-[#f8fafc] border-t border-[#e2e8f0] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded bg-white border border-[#cbd5e1] hover:bg-[#f1f5f9] text-xs font-medium text-[#334155] cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-medium disabled:opacity-45 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? "Saving..." : "Save Configuration"}
          </button>
        </div>
      </div>
    </div>
  );
};
