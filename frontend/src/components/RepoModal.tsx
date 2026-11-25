import React, { useEffect, useState } from "react";
import {
  FolderOpen,
  FolderPlus,
  Download,
  TerminalSquare,
  Pin,
  PinOff,
  Trash2,
  X,
  ArrowUp,
  ChevronRight,
  Folder,
  AlertCircle,
  GitBranch,
} from "lucide-react";
import { Events } from "@wailsio/runtime";
import type {
  CloneProgressEvent,
  RecentRepo,
  RepoLocation,
  WSLDistro,
  WSLEntry,
} from "../../bindings/gitpulse/internal/git/models";
import { GitService } from "../../bindings/gitpulse";

interface RepoModalProps {
  isOpen: boolean;
  canClose: boolean;
  onClose: () => void;
  onOpened: (loc: RepoLocation) => void;
}

type TabMode = "open" | "wsl" | "clone" | "init";

export const RepoModal: React.FC<RepoModalProps> = ({
  isOpen,
  canClose,
  onClose,
  onOpened,
}) => {
  const [tab, setTab] = useState<TabMode>("open");
  const [recents, setRecents] = useState<RecentRepo[]>([]);
  const [pathInput, setPathInput] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [notGitTarget, setNotGitTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // WSL2 browser state
  const [distros, setDistros] = useState<WSLDistro[]>([]);
  const [selectedDistro, setSelectedDistro] = useState("");
  const [wslPath, setWslPath] = useState("");
  const [wslEntries, setWslEntries] = useState<WSLEntry[]>([]);
  const [wslLoading, setWslLoading] = useState(false);

  // Clone state
  const [cloneURL, setCloneURL] = useState("");
  const [cloneParent, setCloneParent] = useState("");
  const [cloneFolder, setCloneFolder] = useState("");
  const [cloneProgress, setCloneProgress] = useState<CloneProgressEvent | null>(
    null
  );

  // Init state
  const [initPath, setInitPath] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    setNotGitTarget(null);
    GitService.GetRecentRepos().then((list) => setRecents(list ?? []));
    GitService.ListWSLDistros()
      .then((list) => {
        const d = list ?? [];
        setDistros(d);
        if (d.length > 0 && !selectedDistro) {
          setSelectedDistro(d[0].name);
          setWslPath(d[0].defaultHome || "/");
        }
      })
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || tab !== "wsl" || !selectedDistro) return;
    loadWSLDir(selectedDistro, wslPath);
  }, [isOpen, tab, selectedDistro]);

  useEffect(() => {
    const off = Events.On("clone:progress", (ev: any) => {
      const payload = (ev?.data ?? ev) as CloneProgressEvent;
      if (payload) {
        setCloneProgress(payload);
      }
    });
    return () => {
      if (typeof off === "function") off();
    };
  }, []);

  if (!isOpen) return null;

  const loadWSLDir = async (distro: string, targetPath: string) => {
    setWslLoading(true);
    setErrorMsg(null);
    try {
      const res = await GitService.BrowseWSLDir(distro, targetPath);
      setWslPath(res.path);
      setWslEntries(res.entries ?? []);
    } catch (err) {
      setErrorMsg(String(err));
    } finally {
      setWslLoading(false);
    }
  };

  const handleOpenPath = async (target: string) => {
    if (!target.trim()) return;
    setBusy(true);
    setErrorMsg(null);
    setNotGitTarget(null);
    try {
      const loc = await GitService.OpenRepo(target.trim());
      onOpened(loc);
    } catch (err) {
      const msg = String(err);
      if (msg.includes("NOT_GIT_REPO")) {
        setNotGitTarget(target.trim());
        setErrorMsg("This folder is not a Git repository (.git not found).");
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const handlePickLocalFolder = async (forField: "open" | "clone" | "init") => {
    try {
      const picked = await GitService.PickFolder("Select Repository Folder");
      if (!picked) return;
      if (forField === "open") {
        setPathInput(picked);
        await handleOpenPath(picked);
      } else if (forField === "clone") {
        setCloneParent(picked);
      } else {
        setInitPath(picked);
      }
    } catch (err) {
      setErrorMsg(String(err));
    }
  };

  const handleInit = async (target: string) => {
    if (!target.trim()) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const loc = await GitService.InitRepo(target.trim());
      onOpened(loc);
    } catch (err) {
      setErrorMsg(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleClone = async () => {
    if (!cloneURL.trim() || !cloneParent.trim()) return;
    setBusy(true);
    setErrorMsg(null);
    setCloneProgress({
      id: "clone",
      stage: "Starting git clone...",
      percent: 5,
      message: `Cloning ${cloneURL.trim()}`,
      done: false,
      error: "",
    });
    try {
      const loc = await GitService.CloneRepo(
        "clone",
        cloneURL.trim(),
        cloneParent.trim(),
        cloneFolder.trim()
      );
      onOpened(loc);
    } catch (err) {
      setErrorMsg(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePin = async (e: React.MouseEvent, p: string) => {
    e.stopPropagation();
    const list = await GitService.TogglePinRepo(p);
    setRecents(list ?? []);
  };

  const handleRemoveRecent = async (e: React.MouseEvent, p: string) => {
    e.stopPropagation();
    const list = await GitService.RemoveRecentRepo(p);
    setRecents(list ?? []);
  };

  const parentLinuxPath = (p: string) => {
    if (!p || p === "/") return "/";
    const parts = p.split("/").filter(Boolean);
    parts.pop();
    return "/" + parts.join("/");
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0f172a]/30 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white border border-[#cbd5e1] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-4 py-3 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-[#0284c7] text-white flex items-center justify-center">
              <GitBranch className="w-3.5 h-3.5" />
            </div>
            <div>
              <h2 className="text-[13px] font-semibold text-[#0b1c30]">
                GitPulse Repository Manager
              </h2>
              <p className="text-[11px] text-[#64748b]">
                Open local Windows folders or native WSL2 Linux repositories
              </p>
            </div>
          </div>
          {canClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[#e2e8f0] text-[#64748b] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Mode Tabs */}
        <div className="px-4 pt-2 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center gap-1">
          {[
            { id: "open", label: "Open & Recent", icon: FolderOpen },
            { id: "wsl", label: `WSL2 Browser (${distros.length})`, icon: TerminalSquare },
            { id: "clone", label: "Clone Remote", icon: Download },
            { id: "init", label: "Init Repository", icon: FolderPlus },
          ].map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setTab(item.id as TabMode);
                  setErrorMsg(null);
                  setNotGitTarget(null);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-md text-[12px] font-medium border-b-2 transition-colors cursor-pointer ${
                  active
                    ? "bg-white border-[#0284c7] text-[#0284c7]"
                    : "border-transparent text-[#64748b] hover:text-[#0b1c30]"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Error / Not-a-git-repo Prompt */}
        {errorMsg && (
          <div className="mx-4 mt-3 px-3 py-2 rounded bg-[#fef2f2] border border-[#fecaca] flex items-center justify-between gap-2 text-xs text-[#991b1b]">
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="w-4 h-4 text-[#dc2626] shrink-0" />
              <span className="truncate">{errorMsg}</span>
            </div>
            {notGitTarget && (
              <button
                onClick={() => handleInit(notGitTarget)}
                disabled={busy}
                className="shrink-0 px-2.5 py-1 rounded bg-[#0284c7] text-white text-[11px] font-medium hover:bg-[#0369a1] cursor-pointer"
              >
                Run git init here
              </button>
            )}
          </div>
        )}

        {/* Tab Body */}
        <div className="p-4 flex-1 overflow-y-auto flex flex-col gap-3">
          {tab === "open" && (
            <>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleOpenPath(pathInput);
                  }}
                  placeholder="Enter path: D:\code\repo or \\wsl.localhost\Ubuntu-24.04\home\user\repo"
                  className="flex-1 px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-xs font-mono outline-none"
                />
                <button
                  onClick={() => handleOpenPath(pathInput)}
                  disabled={busy || !pathInput.trim()}
                  className="px-3 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-medium disabled:opacity-40 cursor-pointer"
                >
                  Open
                </button>
                <button
                  onClick={() => handlePickLocalFolder("open")}
                  className="flex items-center gap-1 px-3 py-1.5 rounded bg-white border border-[#cbd5e1] hover:bg-[#f8fafc] text-xs font-medium text-[#0b1c30] cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-[#0284c7]" />
                  Browse...
                </button>
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#64748b] mb-1.5">
                  Recent Repositories ({recents.length})
                </div>
                {recents.length === 0 ? (
                  <div className="py-8 text-center text-xs text-[#94a3b8] border border-dashed border-[#cbd5e1] rounded-lg">
                    No recent repositories yet. Browse a folder or switch to WSL2 Browser.
                  </div>
                ) : (
                  <div className="flex flex-col divide-y divide-[#f1f5f9] border border-[#e2e8f0] rounded-lg overflow-hidden">
                    {recents.map((r) => (
                      <div
                        key={r.path}
                        onClick={() => handleOpenPath(r.path)}
                        className="group flex items-center justify-between px-3 py-2 hover:bg-[#f0f9ff] cursor-pointer transition-colors"
                      >
                        <div className="min-w-0 flex-1 pr-3">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-[12px] text-[#0b1c30] truncate">
                              {r.name}
                            </span>
                            {r.isWsl ? (
                              <span className="px-1.5 py-0.2 rounded bg-[#ede9fe] text-[#6d28d9] text-[10px] font-mono font-semibold">
                                WSL2 · {r.distro}
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.2 rounded bg-[#f1f5f9] text-[#475569] text-[10px] font-mono">
                                Local
                              </span>
                            )}
                            {r.pinned && (
                              <Pin className="w-3 h-3 text-[#0284c7] fill-[#0284c7]" />
                            )}
                          </div>
                          <div className="font-mono text-[11px] text-[#64748b] truncate mt-0.5">
                            {r.isWsl ? r.linuxPath : r.path}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            title={r.pinned ? "Unpin" : "Pin to top"}
                            onClick={(e) => handleTogglePin(e, r.path)}
                            className="p-1.5 rounded hover:bg-white text-[#64748b] hover:text-[#0284c7] cursor-pointer"
                          >
                            {r.pinned ? (
                              <PinOff className="w-3.5 h-3.5" />
                            ) : (
                              <Pin className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            title="Remove from recent list (keeps local files)"
                            onClick={(e) => handleRemoveRecent(e, r.path)}
                            className="p-1.5 rounded hover:bg-[#fee2e2] text-[#64748b] hover:text-[#dc2626] cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {tab === "wsl" && (
            <>
              {distros.length === 0 ? (
                <div className="py-10 text-center text-xs text-[#64748b]">
                  No WSL2 distributions detected on this Windows machine.
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedDistro}
                      onChange={(e) => {
                        const d = distros.find((x) => x.name === e.target.value);
                        setSelectedDistro(e.target.value);
                        setWslPath(d?.defaultHome || "/");
                      }}
                      className="px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] text-xs font-medium outline-none"
                    >
                      {distros.map((d) => (
                        <option key={d.name} value={d.name}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={wslPath}
                      onChange={(e) => setWslPath(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") loadWSLDir(selectedDistro, wslPath);
                      }}
                      className="flex-1 px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] text-xs font-mono outline-none"
                    />
                    <button
                      onClick={() => loadWSLDir(selectedDistro, wslPath)}
                      className="px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] hover:bg-[#f8fafc] text-xs cursor-pointer"
                    >
                      Go
                    </button>
                    <button
                      onClick={() =>
                        loadWSLDir(selectedDistro, parentLinuxPath(wslPath))
                      }
                      title="Up one level"
                      className="p-1.5 rounded bg-white border border-[#cbd5e1] hover:bg-[#f8fafc] cursor-pointer"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-[#64748b]">
                    <span>
                      Click a <strong className="text-[#16a34a]">GIT</strong> folder to open, or double-click any folder to browse inside.
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          setCloneParent(`wsl://${selectedDistro}${wslPath}`);
                          setTab("clone");
                        }}
                        className="px-2 py-0.5 rounded bg-white border border-[#cbd5e1] hover:border-[#0284c7] text-[#0284c7] cursor-pointer"
                      >
                        Clone into this dir
                      </button>
                      <button
                        onClick={() =>
                          handleOpenPath(`wsl://${selectedDistro}${wslPath}`)
                        }
                        className="px-2 py-0.5 rounded bg-[#0284c7] text-white hover:bg-[#0369a1] cursor-pointer"
                      >
                        Open Current Folder
                      </button>
                    </div>
                  </div>

                  <div className="border border-[#e2e8f0] rounded-lg max-h-64 overflow-y-auto divide-y divide-[#f1f5f9]">
                    {wslLoading ? (
                      <div className="py-8 text-center text-xs text-[#64748b]">
                        Reading WSL2 filesystem...
                      </div>
                    ) : wslEntries.length === 0 ? (
                      <div className="py-8 text-center text-xs text-[#94a3b8]">
                        Empty directory
                      </div>
                    ) : (
                      wslEntries.map((entry) => (
                        <div
                          key={entry.path}
                          onClick={() => {
                            if (entry.isGit) {
                              handleOpenPath(`wsl://${selectedDistro}${entry.path}`);
                            } else {
                              loadWSLDir(selectedDistro, entry.path);
                            }
                          }}
                          className="flex items-center justify-between px-3 py-1.5 hover:bg-[#f0f9ff] cursor-pointer"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Folder
                              className={`w-4 h-4 shrink-0 ${
                                entry.isGit ? "text-[#16a34a]" : "text-[#64748b]"
                              }`}
                            />
                            <span className="font-mono text-xs text-[#0b1c30] truncate">
                              {entry.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {entry.isGit ? (
                              <span className="px-1.5 py-0.5 rounded bg-[#dcfce7] text-[#15803d] text-[10px] font-mono font-semibold">
                                GIT REPO
                              </span>
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-[#94a3b8]" />
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {tab === "clone" && (
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#475569] mb-1">
                  Repository URL (HTTPS or SSH)
                </label>
                <input
                  type="text"
                  value={cloneURL}
                  onChange={(e) => setCloneURL(e.target.value)}
                  placeholder="https://github.com/user/repo.git or git@github.com:user/repo.git"
                  className="w-full px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-xs font-mono outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#475569] mb-1">
                  Target Parent Directory (Local Windows or wsl://Distro/path)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={cloneParent}
                    onChange={(e) => setCloneParent(e.target.value)}
                    placeholder="D:\code or wsl://Ubuntu-24.04/home/user/code"
                    className="flex-1 px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-xs font-mono outline-none"
                  />
                  <button
                    onClick={() => handlePickLocalFolder("clone")}
                    className="px-3 py-1.5 rounded bg-white border border-[#cbd5e1] hover:bg-[#f8fafc] text-xs font-medium cursor-pointer"
                  >
                    Browse...
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#475569] mb-1">
                  Folder Name (optional)
                </label>
                <input
                  type="text"
                  value={cloneFolder}
                  onChange={(e) => setCloneFolder(e.target.value)}
                  placeholder="Defaults to repository name"
                  className="w-full px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-xs font-mono outline-none"
                />
              </div>

              {cloneProgress && (
                <div className="p-3 rounded-lg bg-[#f8fafc] border border-[#e2e8f0] flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[#0b1c30]">
                      {cloneProgress.stage}
                    </span>
                    <span className="font-mono text-[#0284c7] font-semibold">
                      {cloneProgress.percent}%
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-[#e2e8f0] overflow-hidden">
                    <div
                      className="h-full bg-[#0284c7] transition-all duration-150"
                      style={{ width: `${Math.max(4, cloneProgress.percent)}%` }}
                    />
                  </div>
                  <div className="font-mono text-[11px] text-[#64748b] truncate">
                    {cloneProgress.message}
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-1">
                <button
                  onClick={handleClone}
                  disabled={busy || !cloneURL.trim() || !cloneParent.trim()}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-medium disabled:opacity-45 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  {busy ? "Cloning..." : "Clone Repository"}
                </button>
              </div>
            </div>
          )}

          {tab === "init" && (
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#475569] mb-1">
                  Directory to Initialize (Local Windows or wsl://Distro/path)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={initPath}
                    onChange={(e) => setInitPath(e.target.value)}
                    placeholder="D:\code\new-project or wsl://Ubuntu-24.04/home/user/new-project"
                    className="flex-1 px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-xs font-mono outline-none"
                  />
                  <button
                    onClick={() => handlePickLocalFolder("init")}
                    className="px-3 py-1.5 rounded bg-white border border-[#cbd5e1] hover:bg-[#f8fafc] text-xs font-medium cursor-pointer"
                  >
                    Browse...
                  </button>
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => handleInit(initPath)}
                  disabled={busy || !initPath.trim()}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-medium disabled:opacity-45 cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  {busy ? "Initializing..." : "Initialize Git Repository"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
