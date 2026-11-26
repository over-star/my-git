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
  HardDrive,
  Home,
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
import { ConfirmDangerModal } from "./Dialogs";

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
  const [openEnv, setOpenEnv] = useState<"windows" | "wsl">("windows");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [notGitTarget, setNotGitTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeRecentTarget, setRemoveRecentTarget] = useState<RecentRepo | null>(
    null
  );

  // WSL2 browser state
  const [distros, setDistros] = useState<WSLDistro[]>([]);
  const [selectedDistro, setSelectedDistro] = useState("");
  const [wslPath, setWslPath] = useState("/");
  const [wslEntries, setWslEntries] = useState<WSLEntry[]>([]);
  const [wslLoading, setWslLoading] = useState(false);
  const [wslPickFor, setWslPickFor] = useState<"open" | "clone" | "init" | null>(
    null
  );

  // Clone state
  const [cloneURL, setCloneURL] = useState("");
  const [cloneEnv, setCloneEnv] = useState<"windows" | "wsl">("windows");
  const [cloneParent, setCloneParent] = useState("");
  const [cloneFolder, setCloneFolder] = useState("");
  const [cloneProgress, setCloneProgress] = useState<CloneProgressEvent | null>(
    null
  );

  // Init state
  const [initEnv, setInitEnv] = useState<"windows" | "wsl">("windows");
  const [initPath, setInitPath] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    setNotGitTarget(null);
    setWslPickFor(null);
    GitService.GetRecentRepos().then((list) => setRecents(list ?? []));
    GitService.ListWSLDistros()
      .then((list) => {
        const d = list ?? [];
        setDistros(d);
        if (d.length > 0) {
          if (!selectedDistro) {
            setSelectedDistro(d[0].name);
          }
          setWslPath("/");
        }
      })
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || tab !== "wsl" || !selectedDistro) return;
    loadWSLDir(selectedDistro, wslPath || "/");
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

  const normalizeTarget = (
    raw: string,
    env: "windows" | "wsl",
    distro: string
  ) => {
    const t = raw.trim();
    if (!t) return "";
    if (
      t.toLowerCase().startsWith("wsl://") ||
      t.startsWith("\\\\wsl")
    ) {
      return t;
    }
    if (t.startsWith("/") || (env === "wsl" && distro)) {
      const linux = t.startsWith("/") ? t : "/" + t;
      return `wsl://${distro || distros[0]?.name || "Ubuntu"}${linux}`;
    }
    return t;
  };

  const loadWSLDir = async (distro: string, targetPath: string) => {
    setWslLoading(true);
    setErrorMsg(null);
    try {
      const res = await GitService.BrowseWSLDir(distro, targetPath || "/");
      setWslPath(res.path || "/");
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
      const picked = await GitService.PickFolder("Select Windows Folder");
      if (!picked) return;
      if (forField === "open") {
        setOpenEnv("windows");
        setPathInput(picked);
        await handleOpenPath(picked);
      } else if (forField === "clone") {
        setCloneEnv("windows");
        setCloneParent(picked);
      } else {
        setInitEnv("windows");
        setInitPath(picked);
      }
    } catch (err) {
      setErrorMsg(String(err));
    }
  };

  const openWSLBrowserFor = (target: "open" | "clone" | "init") => {
    setWslPickFor(target);
    setTab("wsl");
    if (selectedDistro) {
      loadWSLDir(selectedDistro, wslPath || "/");
    }
  };

  const handleConfirmWSLSelection = (linuxDir: string) => {
    const cleanDir = linuxDir.startsWith("/") ? linuxDir : "/" + linuxDir;
    if (wslPickFor === "clone") {
      setCloneEnv("wsl");
      setCloneParent(cleanDir);
      setWslPickFor(null);
      setTab("clone");
      return;
    }
    if (wslPickFor === "init") {
      setInitEnv("wsl");
      setInitPath(cleanDir);
      setWslPickFor(null);
      setTab("init");
      return;
    }
    setWslPickFor(null);
    handleOpenPath(`wsl://${selectedDistro}${cleanDir}`);
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
    const resolvedParent = normalizeTarget(cloneParent, cloneEnv, selectedDistro);
    if (!cloneURL.trim() || !resolvedParent) return;
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
        resolvedParent,
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

  const handleRemoveRecent = (e: React.MouseEvent, r: RecentRepo) => {
    e.stopPropagation();
    setRemoveRecentTarget(r);
  };

  const confirmRemoveRecent = async () => {
    if (!removeRecentTarget) return;
    const p = removeRecentTarget.path;
    setRemoveRecentTarget(null);
    const list = await GitService.RemoveRecentRepo(p);
    setRecents(list ?? []);
  };

  const parentLinuxPath = (p: string) => {
    if (!p || p === "/") return "/";
    const parts = p.split("/").filter(Boolean);
    parts.pop();
    return "/" + parts.join("/");
  };

  const currentDistroObj = distros.find((d) => d.name === selectedDistro);
  const pathSegments = wslPath.split("/").filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 bg-[#0f172a]/30 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white border border-[#cbd5e1] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-4 py-3 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img
              src="/mygit-icon.png"
              alt="mygit"
              draggable={false}
              className="w-7 h-7 rounded-md shadow-xs select-none"
            />
            <div>
              <h2 className="text-[13px] font-semibold text-[#0b1c30]">
                mygit Repository Manager
              </h2>
              <p className="text-[11px] text-[#64748b]">
                Open local Windows folders or native WSL2 Linux repositories (/...)
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
            {
              id: "wsl",
              label: `WSL2 Browser (${distros.length})`,
              icon: TerminalSquare,
            },
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
                  setWslPickFor(null);
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
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 bg-[#f1f5f9] p-0.5 rounded-md">
                  <button
                    type="button"
                    onClick={() => setOpenEnv("windows")}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium cursor-pointer ${
                      openEnv === "windows"
                        ? "bg-white text-[#0284c7] shadow-sm"
                        : "text-[#64748b]"
                    }`}
                  >
                    <HardDrive className="w-3 h-3" />
                    Windows
                  </button>
                  <button
                    type="button"
                    disabled={distros.length === 0}
                    onClick={() => setOpenEnv("wsl")}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium disabled:opacity-40 cursor-pointer ${
                      openEnv === "wsl"
                        ? "bg-white text-[#7c3aed] shadow-sm"
                        : "text-[#64748b]"
                    }`}
                  >
                    <TerminalSquare className="w-3 h-3" />
                    WSL2
                  </button>
                </div>

                {openEnv === "wsl" && distros.length > 0 && (
                  <select
                    value={selectedDistro}
                    onChange={(e) => setSelectedDistro(e.target.value)}
                    className="px-2 py-1 rounded bg-white border border-[#cbd5e1] text-[11px] font-medium outline-none"
                  >
                    {distros.map((d) => (
                      <option key={d.name} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleOpenPath(
                        normalizeTarget(pathInput, openEnv, selectedDistro)
                      );
                    }
                  }}
                  placeholder={
                    openEnv === "wsl"
                      ? "/home/user/project (starts with / inside WSL2)"
                      : "D:\\code\\repo (or /home/user/project for WSL2)"
                  }
                  className="flex-1 px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-xs font-mono outline-none"
                />
                <button
                  onClick={() =>
                    handleOpenPath(
                      normalizeTarget(pathInput, openEnv, selectedDistro)
                    )
                  }
                  disabled={busy || !pathInput.trim()}
                  className="px-3 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-medium disabled:opacity-40 cursor-pointer"
                >
                  Open
                </button>
                <button
                  onClick={() =>
                    openEnv === "wsl"
                      ? openWSLBrowserFor("open")
                      : handlePickLocalFolder("open")
                  }
                  className="flex items-center gap-1 px-3 py-1.5 rounded bg-white border border-[#cbd5e1] hover:bg-[#f8fafc] text-xs font-medium text-[#0b1c30] cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-[#0284c7]" />
                  {openEnv === "wsl" ? "Browse WSL2..." : "Browse..."}
                </button>
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#64748b] mb-1.5">
                  Recent Repositories ({recents.length})
                </div>
                {recents.length === 0 ? (
                  <div className="py-8 text-center text-xs text-[#94a3b8] border border-dashed border-[#cbd5e1] rounded-lg">
                    No recent repositories yet. Browse Windows or WSL2 folders above.
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
                            onClick={(e) => handleRemoveRecent(e, r)}
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
                        setSelectedDistro(e.target.value);
                        loadWSLDir(e.target.value, "/");
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
                      placeholder="/home/user/project"
                      className="flex-1 px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] text-xs font-mono outline-none"
                    />
                    <button
                      onClick={() => loadWSLDir(selectedDistro, wslPath)}
                      className="px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] hover:bg-[#f8fafc] text-xs cursor-pointer"
                    >
                      Go
                    </button>
                    <button
                      onClick={() => loadWSLDir(selectedDistro, "/")}
                      title="Go to Root (/)"
                      className="px-2 py-1.5 rounded bg-white border border-[#cbd5e1] hover:bg-[#f8fafc] text-xs font-mono cursor-pointer"
                    >
                      /
                    </button>
                    {currentDistroObj?.defaultHome && (
                      <button
                        onClick={() =>
                          loadWSLDir(
                            selectedDistro,
                            currentDistroObj.defaultHome
                          )
                        }
                        title={`Go to Home (${currentDistroObj.defaultHome})`}
                        className="p-1.5 rounded bg-white border border-[#cbd5e1] hover:bg-[#f8fafc] cursor-pointer"
                      >
                        <Home className="w-3.5 h-3.5" />
                      </button>
                    )}
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

                  {/* Breadcrumbs */}
                  <div className="flex items-center gap-1 flex-wrap text-[11px] font-mono bg-[#f8fafc] border border-[#e2e8f0] rounded px-2.5 py-1">
                    <button
                      onClick={() => loadWSLDir(selectedDistro, "/")}
                      className="text-[#0284c7] font-semibold hover:underline cursor-pointer"
                    >
                      /
                    </button>
                    {pathSegments.map((seg, i) => {
                      const target = "/" + pathSegments.slice(0, i + 1).join("/");
                      return (
                        <React.Fragment key={target}>
                          {i > 0 && <span className="text-[#94a3b8]">/</span>}
                          <button
                            onClick={() => loadWSLDir(selectedDistro, target)}
                            className="text-[#334155] hover:text-[#0284c7] hover:underline cursor-pointer"
                          >
                            {seg}
                          </button>
                        </React.Fragment>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-[#64748b]">
                    <span>
                      {wslPickFor === "clone"
                        ? "Navigate to target directory and click Select Folder for Clone."
                        : wslPickFor === "init"
                        ? "Navigate to target directory and click Select Folder for Init."
                        : "Click a GIT REPO folder to open, or browse into any folder."}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!wslPickFor && (
                        <button
                          onClick={() => {
                            setCloneEnv("wsl");
                            setCloneParent(wslPath);
                            setTab("clone");
                          }}
                          className="px-2 py-1 rounded bg-white border border-[#cbd5e1] hover:border-[#0284c7] text-[#0284c7] cursor-pointer"
                        >
                          Clone Here
                        </button>
                      )}
                      <button
                        onClick={() => handleConfirmWSLSelection(wslPath)}
                        className="px-2.5 py-1 rounded bg-[#0284c7] text-white hover:bg-[#0369a1] font-medium cursor-pointer"
                      >
                        {wslPickFor ? "Select This Folder" : "Open This Folder"}
                      </button>
                    </div>
                  </div>

                  <div className="border border-[#e2e8f0] rounded-lg max-h-60 overflow-y-auto divide-y divide-[#f1f5f9]">
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
                            if (entry.isGit && !wslPickFor) {
                              handleOpenPath(
                                `wsl://${selectedDistro}${entry.path}`
                              );
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
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 bg-[#f1f5f9] p-0.5 rounded-md">
                  <button
                    type="button"
                    onClick={() => setCloneEnv("windows")}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium cursor-pointer ${
                      cloneEnv === "windows"
                        ? "bg-white text-[#0284c7] shadow-sm"
                        : "text-[#64748b]"
                    }`}
                  >
                    <HardDrive className="w-3 h-3" />
                    Windows Local
                  </button>
                  <button
                    type="button"
                    disabled={distros.length === 0}
                    onClick={() => setCloneEnv("wsl")}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium disabled:opacity-40 cursor-pointer ${
                      cloneEnv === "wsl"
                        ? "bg-white text-[#7c3aed] shadow-sm"
                        : "text-[#64748b]"
                    }`}
                  >
                    <TerminalSquare className="w-3 h-3" />
                    WSL2
                  </button>
                </div>
                {cloneEnv === "wsl" && distros.length > 0 && (
                  <select
                    value={selectedDistro}
                    onChange={(e) => setSelectedDistro(e.target.value)}
                    className="px-2 py-1 rounded bg-white border border-[#cbd5e1] text-[11px] font-medium outline-none"
                  >
                    {distros.map((d) => (
                      <option key={d.name} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

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
                  Target Parent Directory (
                  {cloneEnv === "wsl"
                    ? `WSL2 ${selectedDistro}: /...`
                    : "Windows Path"}
                  )
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={cloneParent}
                    onChange={(e) => setCloneParent(e.target.value)}
                    placeholder={
                      cloneEnv === "wsl"
                        ? "/home/user/code"
                        : "D:\\code"
                    }
                    className="flex-1 px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-xs font-mono outline-none"
                  />
                  <button
                    onClick={() =>
                      cloneEnv === "wsl"
                        ? openWSLBrowserFor("clone")
                        : handlePickLocalFolder("clone")
                    }
                    className="px-3 py-1.5 rounded bg-white border border-[#cbd5e1] hover:bg-[#f8fafc] text-xs font-medium cursor-pointer"
                  >
                    {cloneEnv === "wsl" ? "Browse WSL2..." : "Browse..."}
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
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 bg-[#f1f5f9] p-0.5 rounded-md">
                  <button
                    type="button"
                    onClick={() => setInitEnv("windows")}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium cursor-pointer ${
                      initEnv === "windows"
                        ? "bg-white text-[#0284c7] shadow-sm"
                        : "text-[#64748b]"
                    }`}
                  >
                    <HardDrive className="w-3 h-3" />
                    Windows Local
                  </button>
                  <button
                    type="button"
                    disabled={distros.length === 0}
                    onClick={() => setInitEnv("wsl")}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium disabled:opacity-40 cursor-pointer ${
                      initEnv === "wsl"
                        ? "bg-white text-[#7c3aed] shadow-sm"
                        : "text-[#64748b]"
                    }`}
                  >
                    <TerminalSquare className="w-3 h-3" />
                    WSL2
                  </button>
                </div>
                {initEnv === "wsl" && distros.length > 0 && (
                  <select
                    value={selectedDistro}
                    onChange={(e) => setSelectedDistro(e.target.value)}
                    className="px-2 py-1 rounded bg-white border border-[#cbd5e1] text-[11px] font-medium outline-none"
                  >
                    {distros.map((d) => (
                      <option key={d.name} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#475569] mb-1">
                  Directory to Initialize (
                  {initEnv === "wsl"
                    ? `WSL2 ${selectedDistro}: /...`
                    : "Windows Path"}
                  )
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={initPath}
                    onChange={(e) => setInitPath(e.target.value)}
                    placeholder={
                      initEnv === "wsl"
                        ? "/home/user/new-project"
                        : "D:\\code\\new-project"
                    }
                    className="flex-1 px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-xs font-mono outline-none"
                  />
                  <button
                    onClick={() =>
                      initEnv === "wsl"
                        ? openWSLBrowserFor("init")
                        : handlePickLocalFolder("init")
                    }
                    className="px-3 py-1.5 rounded bg-white border border-[#cbd5e1] hover:bg-[#f8fafc] text-xs font-medium cursor-pointer"
                  >
                    {initEnv === "wsl" ? "Browse WSL2..." : "Browse..."}
                  </button>
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() =>
                    handleInit(
                      normalizeTarget(initPath, initEnv, selectedDistro)
                    )
                  }
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

      <ConfirmDangerModal
        open={Boolean(removeRecentTarget)}
        title="Remove Recent Repository?"
        description="Remove this repository from the mygit recent list? Local files on disk will NOT be deleted."
        detail={
          removeRecentTarget
            ? `${removeRecentTarget.name} (${
                removeRecentTarget.isWsl
                  ? removeRecentTarget.linuxPath
                  : removeRecentTarget.path
              })`
            : undefined
        }
        confirmLabel="Remove from List"
        onCancel={() => setRemoveRecentTarget(null)}
        onConfirm={confirmRemoveRecent}
      />
    </div>
  );
};
