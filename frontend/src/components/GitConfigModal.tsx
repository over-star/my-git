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
  KeyRound,
  Link2,
  ChevronDown,
  ChevronRight,
  Info,
} from "lucide-react";
import type {
  GitConfigBundle,
  RemoteInfo,
  RepoLocation,
  SSHKeyInfo,
  WSLDistro,
} from "../../bindings/gitpulse/internal/git/models";
import { GitService } from "../../bindings/gitpulse";

export function httpsToSshUrl(url: string): string | null {
  const m = url.trim().match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  if (!m) return null;
  return `git@${m[1]}:${m[2]}.git`;
}

interface GitConfigModalProps {
  open: boolean;
  repo: RepoLocation | null;
  initialScope?: "local" | "global";
  onClose: () => void;
  onSaved: (msg: string) => void;
  onNotify: (type: "success" | "error" | "info", msg: string) => void;
}

const SourceTag: React.FC<{
  scope: "local" | "global";
  localVal: string;
  globalVal?: string;
  emptyGlobalText?: string;
  onResetLocal?: () => void;
}> = ({
  scope,
  localVal,
  globalVal,
  emptyGlobalText = "未设置",
  onResetLocal,
}) => {
  if (scope !== "local") return null;
  const hasLocal = localVal.trim() !== "";
  if (hasLocal) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="px-1.5 py-[1px] rounded bg-[#e0f2fe] text-[#0369a1] text-[10px] font-medium">
          当前仓库覆盖
        </span>
        {onResetLocal && (
          <button
            type="button"
            onClick={onResetLocal}
            title="清除当前仓库覆盖，恢复继承全局"
            className="text-[10px] text-[#64748b] hover:text-[#0284c7] underline cursor-pointer"
          >
            恢复全局
          </button>
        )}
      </span>
    );
  }
  const gText = globalVal?.trim() ? globalVal.trim() : emptyGlobalText;
  return (
    <span
      title={`当前未在仓库单独设置，将使用全局值：${gText}`}
      className="px-1.5 py-[1px] rounded bg-[#f1f5f9] text-[#64748b] text-[10px] font-medium max-w-[180px] truncate"
    >
      继承全局: {gText}
    </span>
  );
};

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
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Form fields
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("");
  const [autoCrlf, setAutoCrlf] = useState("");
  const [pullRebase, setPullRebase] = useState("");
  const [gpgSign, setGpgSign] = useState("");
  const [signingKey, setSigningKey] = useState("");
  const [sshCommand, setSshCommand] = useState("");
  const [sshKeys, setSshKeys] = useState<SSHKeyInfo[]>([]);
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [remoteDrafts, setRemoteDrafts] = useState<Record<string, string>>({});
  const [sshTestResult, setSshTestResult] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);
  const [testingSsh, setTestingSsh] = useState(false);

  useEffect(() => {
    if (!open) return;
    const defaultScope = repo ? initialScope ?? "local" : "global";
    setScope(defaultScope);
    setGlobalDistro(repo?.isWsl ? repo.distro : "");
    setShowAdvanced(false);

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
      const effectiveDistro =
        targetScope === "global"
          ? distroForGlobal
          : repo?.isWsl
          ? repo.distro
          : "";
      const [b, keys, rem] = await Promise.all([
        GitService.GetGitConfig(repo?.path ?? "", effectiveDistro),
        GitService.ListSSHKeys(repo?.path ?? "", effectiveDistro),
        repo?.path ? GitService.ListRemotes(repo.path) : Promise.resolve([]),
      ]);
      setBundle(b);
      setSshKeys(keys ?? []);
      const rList = rem ?? [];
      setRemotes(rList);
      const drafts: Record<string, string> = {};
      for (const r of rList) {
        drafts[r.name] = r.pushUrl || r.fetchUrl;
      }
      setRemoteDrafts(drafts);
      const src = targetScope === "local" ? b.local : b.global;
      setUserName(src.userName ?? "");
      setUserEmail(src.userEmail ?? "");
      setDefaultBranch(src.defaultBranch ?? "");
      setAutoCrlf(src.autoCrlf ?? "");
      setPullRebase(src.pullRebase ?? "");
      setGpgSign(src.gpgSign ?? "");
      setSigningKey(src.signingKey ?? "");
      setSshCommand(src.sshCommand ?? "");
    } catch (err) {
      onNotify("error", `加载 Git 配置失败: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setSshTestResult(null);
    loadConfig(scope, globalDistro);
  }, [open, scope, globalDistro, repo?.path]);

  if (!open) return null;

  const isWSLActive =
    (scope === "local" && Boolean(repo?.isWsl)) ||
    (scope === "global" && globalDistro !== "");
  const activeDistroName = scope === "local" ? repo?.distro : globalDistro;

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
        sshCommand,
      });
      if (res.success) {
        onSaved(res.message);
        onClose();
      } else {
        onNotify("error", res.message || "保存 Git 配置失败");
      }
    } catch (err) {
      onNotify("error", String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleClearAllLocal = () => {
    setUserName("");
    setUserEmail("");
    setAutoCrlf("");
    setPullRebase("");
    setGpgSign("");
    setSigningKey("");
    setSshCommand("");
  };

  const buildSshCmdForKey = (k: SSHKeyInfo) => {
    const slashPath = k.path.replace(/\\/g, "/");
    if (isWSLActive && k.source === "windows") {
      return `/mnt/c/Windows/System32/OpenSSH/ssh.exe -i "${k.path}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`;
    }
    if (!isWSLActive) {
      return `ssh -i "${slashPath}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`;
    }
    return `ssh -i "${k.path}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`;
  };

  const handleSaveRemote = async (name: string, url: string) => {
    if (!repo) return;
    try {
      const res = await GitService.SetRemoteURL(repo.path, name, url);
      if (res.success) {
        onNotify("success", res.message);
        await loadConfig(scope, globalDistro);
      } else {
        onNotify("error", res.message || "更新远程地址失败");
      }
    } catch (err) {
      onNotify("error", String(err));
    }
  };

  const handleTestSSH = async () => {
    setTestingSsh(true);
    setSshTestResult(null);
    try {
      const res = await GitService.TestSSHConnection(
        scope === "local" ? repo?.path ?? "" : "",
        sshCommand,
        scope === "global" ? globalDistro : repo?.isWsl ? repo.distro : ""
      );
      setSshTestResult({ ok: res.success, msg: res.message });
    } catch (err) {
      setSshTestResult({ ok: false, msg: String(err) });
    } finally {
      setTestingSsh(false);
    }
  };

  // Compute live preview of effective values in local scope
  const previewName =
    scope === "local"
      ? userName.trim() || bundle?.global.userName || ""
      : userName.trim();
  const previewEmail =
    scope === "local"
      ? userEmail.trim() || bundle?.global.userEmail || ""
      : userEmail.trim();
  const previewNameSource =
    scope === "local"
      ? userName.trim()
        ? "当前仓库"
        : bundle?.global.userName
        ? "全局"
        : "未设置"
      : "全局";
  const hasAdvancedOverrides =
    Boolean(sshCommand.trim()) ||
    Boolean(gpgSign.trim()) ||
    Boolean(signingKey.trim());

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0f172a]/30 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white border border-[#cbd5e1] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-[#0284c7] text-white flex items-center justify-center">
              <Settings className="w-3.5 h-3.5" />
            </div>
            <div>
              <h2 className="text-[13px] font-semibold text-[#0b1c30]">
                Git 配置
              </h2>
              <p className="text-[11px] text-[#64748b]">
                规则：当前仓库配置 (.git/config) 优先于全局配置 (~/.gitconfig)，留空即继承全局
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
        <div className="px-4 pt-2 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between shrink-0">
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
                <span>当前仓库 ({repo.name})</span>
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
              <span>全局默认 (--global)</span>
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
                <option value="">Windows 本机 Git</option>
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
        <div className="p-4 overflow-y-auto flex flex-col gap-3.5">
          {/* Context Banner */}
          <div
            className={`px-3 py-2 rounded-lg border text-[11px] flex items-center justify-between gap-2 ${
              isWSLActive
                ? "bg-[#faf5ff] border-[#ddd6fe] text-[#5b21b6]"
                : "bg-[#f0f9ff] border-[#bae6fd] text-[#0369a1]"
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0" />
              {scope === "local" ? (
                <span>
                  正在编辑 <strong>{repo?.name}</strong> 的独立配置（仅对本仓库生效，留空项自动沿用{" "}
                  {repo?.isWsl ? `WSL2 · ${repo.distro}` : "Windows"} 全局配置）
                </span>
              ) : isWSLActive ? (
                <span>
                  正在编辑 WSL2 <strong>{activeDistroName}</strong> 的全局配置（~/.gitconfig）
                </span>
              ) : (
                <span>
                  正在编辑 <strong>Windows 本机</strong>的全局配置（~/.gitconfig）
                </span>
              )}
            </span>
            {scope === "local" && (
              <button
                type="button"
                onClick={handleClearAllLocal}
                className="flex items-center gap-1 text-[10px] underline hover:opacity-80 shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                全部恢复全局
              </button>
            )}
          </div>

          {loading ? (
            <div className="py-10 text-center text-xs text-[#64748b]">
              正在读取 Git 配置...
            </div>
          ) : (
            <>
              {/* Basic Author Identity */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <label className="flex items-center gap-1 text-[11px] font-semibold text-[#475569]">
                      <User className="w-3 h-3" />
                      作者名称 (user.name)
                    </label>
                    <SourceTag
                      scope={scope}
                      localVal={userName}
                      globalVal={bundle?.global.userName}
                      onResetLocal={() => setUserName("")}
                    />
                  </div>
                  <input
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder={
                      scope === "local" && bundle?.global.userName
                        ? `继承全局 (${bundle.global.userName})`
                        : "输入你的名字"
                    }
                    className="w-full px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-xs outline-none"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <label className="text-[11px] font-semibold text-[#475569]">
                      作者邮箱 (user.email)
                    </label>
                    <SourceTag
                      scope={scope}
                      localVal={userEmail}
                      globalVal={bundle?.global.userEmail}
                      onResetLocal={() => setUserEmail("")}
                    />
                  </div>
                  <input
                    type="email"
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    placeholder={
                      scope === "local" && bundle?.global.userEmail
                        ? `继承全局 (${bundle.global.userEmail})`
                        : "you@example.com"
                    }
                    className="w-full px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-xs outline-none"
                  />
                </div>
              </div>

              {/* Common Behavior Settings */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <label className="text-[11px] font-semibold text-[#475569]">
                      Pull 拉取方式 (pull.rebase)
                    </label>
                    <SourceTag
                      scope={scope}
                      localVal={pullRebase}
                      globalVal={bundle?.global.pullRebase}
                      emptyGlobalText="Git 默认"
                    />
                  </div>
                  <select
                    value={pullRebase}
                    onChange={(e) => setPullRebase(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-xs outline-none"
                  >
                    <option value="">
                      {scope === "local"
                        ? `继承全局 (${
                            bundle?.global.pullRebase || "Git 默认"
                          })`
                        : "未设置 (Git 默认)"}
                    </option>
                    <option value="false">false (Merge 合并)</option>
                    <option value="true">true (Rebase 变基)</option>
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <label className="text-[11px] font-semibold text-[#475569]">
                      换行符处理 (core.autocrlf)
                    </label>
                    <SourceTag
                      scope={scope}
                      localVal={autoCrlf}
                      globalVal={bundle?.global.autoCrlf}
                      emptyGlobalText="Git 默认"
                    />
                  </div>
                  <select
                    value={autoCrlf}
                    onChange={(e) => setAutoCrlf(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-xs outline-none"
                  >
                    <option value="">
                      {scope === "local"
                        ? `继承全局 (${bundle?.global.autoCrlf || "Git 默认"})`
                        : "未设置 (Git 默认)"}
                    </option>
                    <option value="true">true (Windows 检出转 CRLF)</option>
                    <option value="input">input (提交转 LF，WSL2 推荐)</option>
                    <option value="false">false (不自动转换)</option>
                  </select>
                </div>
              </div>

              {scope === "global" && (
                <div>
                  <label className="block text-[11px] font-semibold text-[#475569] mb-1">
                    新建仓库默认分支名 (init.defaultBranch)
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

              {/* Collapsible Advanced Section */}
              <div className="rounded-lg border border-[#e2e8f0] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="w-full px-3 py-2 bg-[#f8fafc] hover:bg-[#f1f5f9] flex items-center justify-between text-[12px] font-medium text-[#334155] cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    {showAdvanced ? (
                      <ChevronDown className="w-3.5 h-3.5 text-[#64748b]" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-[#64748b]" />
                    )}
                    <span>高级设置（SSH 密钥 / 提交签名 / 远程仓库地址）</span>
                  </span>
                  {!showAdvanced && hasAdvancedOverrides && (
                    <span className="px-1.5 py-0.5 rounded bg-[#e0f2fe] text-[#0369a1] text-[10px]">
                      已自定义
                    </span>
                  )}
                </button>

                {showAdvanced && (
                  <div className="p-3 flex flex-col gap-3 border-t border-[#e2e8f0] bg-white">
                    {/* GPG Signing */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <label className="text-[11px] font-semibold text-[#475569]">
                            提交签名 (commit.gpgsign)
                          </label>
                          <SourceTag
                            scope={scope}
                            localVal={gpgSign}
                            globalVal={bundle?.global.gpgSign}
                            emptyGlobalText="false"
                          />
                        </div>
                        <select
                          value={gpgSign}
                          onChange={(e) => setGpgSign(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-xs outline-none"
                        >
                          <option value="">
                            {scope === "local"
                              ? `继承全局 (${bundle?.global.gpgSign || "false"})`
                              : "未设置 (false)"}
                          </option>
                          <option value="true">true (开启签名)</option>
                          <option value="false">false</option>
                        </select>
                      </div>
                      <div>
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <label className="text-[11px] font-semibold text-[#475569]">
                            签名密钥 (user.signingkey)
                          </label>
                          <SourceTag
                            scope={scope}
                            localVal={signingKey}
                            globalVal={bundle?.global.signingKey}
                          />
                        </div>
                        <input
                          type="text"
                          value={signingKey}
                          onChange={(e) => setSigningKey(e.target.value)}
                          placeholder="可选 GPG/SSH 密钥 ID"
                          className="w-full px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-xs font-mono outline-none"
                        />
                      </div>
                    </div>

                    {/* SSH Key / core.sshCommand */}
                    <div className="pt-2 border-t border-[#f1f5f9] flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1 text-[11px] font-semibold text-[#475569]">
                            <KeyRound className="w-3 h-3 text-[#0284c7]" />
                            SSH 认证命令 (core.sshCommand)
                          </label>
                          <SourceTag
                            scope={scope}
                            localVal={sshCommand}
                            globalVal={bundle?.global.sshCommand}
                            emptyGlobalText="默认自动检测"
                            onResetLocal={() => setSshCommand("")}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setSshCommand("")}
                          className="text-[10px] text-[#0284c7] hover:underline cursor-pointer"
                        >
                          使用默认 SSH
                        </button>
                      </div>
                      {sshKeys.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {sshKeys.map((k) => {
                            const cmdStr = buildSshCmdForKey(k);
                            const active = sshCommand === cmdStr;
                            return (
                              <button
                                key={`${k.source}:${k.path}`}
                                type="button"
                                onClick={() => setSshCommand(cmdStr)}
                                title={k.path}
                                className={`px-2 py-0.5 rounded text-[10px] font-mono border cursor-pointer transition-colors ${
                                  active
                                    ? "bg-[#e0f2fe] border-[#0284c7] text-[#0369a1] font-semibold"
                                    : "bg-[#f8fafc] border-[#e2e8f0] text-[#334155] hover:border-[#0284c7]"
                                }`}
                              >
                                {k.source === "wsl" ? "WSL: " : "Win: "}
                                {k.name}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={sshCommand}
                          onChange={(e) => {
                            setSshCommand(e.target.value);
                            setSshTestResult(null);
                          }}
                          placeholder="默认（自动使用 ~/.ssh/id_*；WSL2 无密钥时自动回退 Windows OpenSSH）"
                          className="flex-1 px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-[11px] font-mono outline-none"
                        />
                        <button
                          type="button"
                          disabled={testingSsh}
                          onClick={handleTestSSH}
                          className="px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] hover:border-[#0284c7] text-[11px] font-medium text-[#0284c7] disabled:opacity-50 shrink-0 cursor-pointer"
                        >
                          {testingSsh ? "测试中..." : "测试 SSH"}
                        </button>
                      </div>
                      {sshTestResult && (
                        <div
                          className={`px-2.5 py-1.5 rounded text-[11px] font-mono border ${
                            sshTestResult.ok
                              ? "bg-[#f0fdf4] border-[#bbf7d0] text-[#15803d]"
                              : "bg-[#fef2f2] border-[#fecaca] text-[#dc2626]"
                          }`}
                        >
                          {sshTestResult.msg}
                        </div>
                      )}
                    </div>

                    {/* Remotes (Local Repo Only) */}
                    {scope === "local" && repo && (
                      <div className="pt-2 border-t border-[#f1f5f9] flex flex-col gap-1.5">
                        <label className="flex items-center gap-1 text-[11px] font-semibold text-[#475569]">
                          <Link2 className="w-3 h-3 text-[#0284c7]" />
                          远程仓库地址 (Remotes)
                        </label>
                        {remotes.length === 0 ? (
                          <div className="text-[11px] text-[#94a3b8]">
                            未配置远程仓库。
                          </div>
                        ) : (
                          remotes.map((r) => {
                            const val = remoteDrafts[r.name] ?? "";
                            const sshSuggestion = httpsToSshUrl(val);
                            const isSsh =
                              val.toLowerCase().startsWith("git@") ||
                              val.toLowerCase().startsWith("ssh://");
                            return (
                              <div
                                key={r.name}
                                className="flex items-center gap-1.5"
                              >
                                <span className="px-1.5 py-1 rounded bg-[#f1f5f9] font-mono text-[11px] font-semibold text-[#0b1c30] shrink-0">
                                  {r.name}
                                </span>
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold shrink-0 ${
                                    isSsh
                                      ? "bg-[#dcfce7] text-[#15803d]"
                                      : "bg-[#fef3c7] text-[#b45309]"
                                  }`}
                                >
                                  {isSsh ? "SSH" : "HTTPS"}
                                </span>
                                <input
                                  type="text"
                                  value={val}
                                  onChange={(e) =>
                                    setRemoteDrafts((d) => ({
                                      ...d,
                                      [r.name]: e.target.value,
                                    }))
                                  }
                                  className="flex-1 px-2 py-1 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-[11px] font-mono outline-none"
                                />
                                {sshSuggestion && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setRemoteDrafts((d) => ({
                                        ...d,
                                        [r.name]: sshSuggestion,
                                      }));
                                      handleSaveRemote(r.name, sshSuggestion);
                                    }}
                                    className="px-2 py-1 rounded bg-[#f0f9ff] border border-[#bae6fd] hover:bg-[#e0f2fe] text-[#0369a1] text-[10px] font-medium shrink-0 cursor-pointer"
                                  >
                                    转为 SSH
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleSaveRemote(r.name, val)}
                                  className="px-2 py-1 rounded bg-white border border-[#cbd5e1] hover:bg-[#f8fafc] text-[10px] font-medium text-[#334155] shrink-0 cursor-pointer"
                                >
                                  更新
                                </button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Effective Summary */}
              {bundle && (
                <div className="px-3 py-2 rounded-lg bg-[#f8fafc] border border-[#e2e8f0] text-[11px] text-[#64748b] flex items-center justify-between gap-2">
                  <span className="truncate">
                    保存后实际生效身份：
                    <strong className="text-[#0b1c30] ml-1">
                      {previewName || "(未设置)"}{" "}
                      {previewEmail ? `<${previewEmail}>` : ""}
                    </strong>
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${
                      previewNameSource === "当前仓库"
                        ? "bg-[#e0f2fe] text-[#0369a1]"
                        : previewNameSource === "全局"
                        ? "bg-[#e2e8f0] text-[#475569]"
                        : "bg-[#fef2f2] text-[#dc2626]"
                    }`}
                  >
                    来源：{previewNameSource}
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-[#f8fafc] border-t border-[#e2e8f0] flex items-center justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded bg-white border border-[#cbd5e1] hover:bg-[#f1f5f9] text-xs font-medium text-[#334155] cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-medium disabled:opacity-45 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            {saving
              ? "保存中..."
              : scope === "local"
              ? "保存到当前仓库"
              : "保存到全局配置"}
          </button>
        </div>
      </div>
    </div>
  );
};
