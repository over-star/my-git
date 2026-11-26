import React from "react";
import {
  X,
  Settings,
  Type,
  GitBranch,
  User,
  RefreshCw,
  Download,
  RotateCw,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import type { UpdateStatus } from "../../bindings/gitpulse";
import type { AppSettings } from "../../bindings/gitpulse/internal/store/models";
import { formatBytes } from "./StatusBadge";

interface AppSettingsModalProps {
  open: boolean;
  settings: AppSettings;
  hasActiveRepo: boolean;
  effectiveAuthor: { name: string; email: string };
  updateStatus: UpdateStatus;
  onClose: () => void;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onOpenGitConfig: (scope: "global" | "local") => void;
  onCheckUpdate: () => void;
  onDownloadUpdate: () => void;
  onRestartUpdate: () => void;
  onOpenRelease: (url: string) => void;
}

const FONT_SIZE_PRESETS = [
  { label: "小 (12px)", value: 12 },
  { label: "标准 (13px)", value: 13 },
  { label: "舒适 (14px)", value: 14 },
  { label: "大号 (15px)", value: 15 },
  { label: "超大 (16px)", value: 16 },
];

const DIFF_FONT_PRESETS = [
  { label: "11px", value: 11 },
  { label: "12px", value: 12 },
  { label: "13px", value: 13 },
  { label: "14px", value: 14 },
  { label: "15px", value: 15 },
  { label: "16px", value: 16 },
];

export const AppSettingsModal: React.FC<AppSettingsModalProps> = ({
  open,
  settings,
  hasActiveRepo,
  effectiveAuthor,
  updateStatus,
  onClose,
  onUpdateSettings,
  onOpenGitConfig,
  onCheckUpdate,
  onDownloadUpdate,
  onRestartUpdate,
  onOpenRelease,
}) => {
  if (!open) return null;

  const isUpdateBusy =
    updateStatus.state === "checking" ||
    updateStatus.state === "downloading" ||
    updateStatus.state === "verifying" ||
    updateStatus.state === "installing";
  const avail = updateStatus.available;

  const stageLabel =
    updateStatus.state === "checking"
      ? "正在检查 GitHub 最新版本..."
      : updateStatus.state === "downloading"
      ? `正在下载更新包 (${updateStatus.percent}%)...`
      : updateStatus.state === "verifying"
      ? "正在校验 SHA-256 完整性..."
      : updateStatus.state === "installing"
      ? "正在准备安装文件..."
      : "";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[88vh] rounded-xl bg-white border border-[#cbd5e1] shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-[#0284c7]" />
            <h2 className="text-[14px] font-semibold text-[#0b1c30]">
              软件设置
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[#e2e8f0] text-[#64748b] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 text-[12px] text-[#334155]">
          {/* Section 1: 外观与字体 */}
          <section className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc]/70 p-3.5 flex flex-col gap-3">
            <div className="flex items-center gap-1.5 font-semibold text-[#0b1c30] text-[13px]">
              <Type className="w-4 h-4 text-[#0284c7]" />
              <span>字体与显示</span>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-[#334155]">界面字体大小</span>
                <span className="font-mono text-[11px] text-[#64748b]">
                  {settings.fontSize}px
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {FONT_SIZE_PRESETS.map((p) => {
                  const active = settings.fontSize === p.value;
                  return (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => onUpdateSettings({ fontSize: p.value })}
                      className={`px-2.5 py-1 rounded border text-[11px] font-medium cursor-pointer transition-colors ${
                        active
                          ? "bg-[#0284c7] border-[#0284c7] text-white"
                          : "bg-white border-[#cbd5e1] text-[#334155] hover:bg-[#f1f5f9]"
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-[#334155]">
                  代码 / Diff 字体大小
                </span>
                <span className="font-mono text-[11px] text-[#64748b]">
                  {settings.diffFontSize}px
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {DIFF_FONT_PRESETS.map((p) => {
                  const active = settings.diffFontSize === p.value;
                  return (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => onUpdateSettings({ diffFontSize: p.value })}
                      className={`px-2.5 py-1 rounded border font-mono text-[11px] font-medium cursor-pointer transition-colors ${
                        active
                          ? "bg-[#0284c7] border-[#0284c7] text-white"
                          : "bg-white border-[#cbd5e1] text-[#334155] hover:bg-[#f1f5f9]"
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Section 2: 常规行为 */}
          <section className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc]/70 p-3.5 flex flex-col gap-3">
            <div className="flex items-center gap-1.5 font-semibold text-[#0b1c30] text-[13px]">
              <GitBranch className="w-4 h-4 text-[#0284c7]" />
              <span>常规行为</span>
            </div>

            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <div>
                <div className="font-medium text-[#0b1c30]">
                  切回窗口时自动刷新仓库
                </div>
                <div className="text-[11px] text-[#64748b]">
                  从编辑器或终端切换回本软件时自动更新状态与分支（WSL2 大仓库可按需关闭）
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.autoRefreshOnFocus}
                onChange={(e) =>
                  onUpdateSettings({ autoRefreshOnFocus: e.target.checked })
                }
                className="w-4 h-4 accent-[#0284c7] cursor-pointer shrink-0"
              />
            </label>

            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-medium text-[#0b1c30]">
                  打开项目默认提交视图范围
                </div>
                <div className="text-[11px] text-[#64748b]">
                  新打开或切换仓库标签页时，Commit Graph 的默认展示范围
                </div>
              </div>
              <div className="flex items-center rounded-md border border-[#cbd5e1] bg-white p-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSettings({ defaultHistoryScope: "all" })
                  }
                  className={`px-2.5 py-1 rounded text-[11px] font-medium cursor-pointer ${
                    settings.defaultHistoryScope === "all"
                      ? "bg-[#0284c7] text-white"
                      : "text-[#475569] hover:text-[#0b1c30]"
                  }`}
                >
                  All Commits
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSettings({ defaultHistoryScope: "branch" })
                  }
                  className={`px-2.5 py-1 rounded text-[11px] font-medium cursor-pointer ${
                    settings.defaultHistoryScope === "branch"
                      ? "bg-[#0284c7] text-white"
                      : "text-[#475569] hover:text-[#0b1c30]"
                  }`}
                >
                  Selected Only
                </button>
              </div>
            </div>
          </section>

          {/* Section 3: Git 全局配置 */}
          <section className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc]/70 p-3.5 flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-semibold text-[#0b1c30] text-[13px]">
                <User className="w-4 h-4 text-[#0284c7]" />
                <span>Git 全局与仓库配置</span>
              </div>
              {effectiveAuthor.name || effectiveAuthor.email ? (
                <span className="font-mono text-[11px] text-[#475569] truncate max-w-[260px]">
                  {effectiveAuthor.name}
                  {effectiveAuthor.email ? ` <${effectiveAuthor.email}>` : ""}
                </span>
              ) : (
                <span className="text-[11px] text-[#94a3b8]">未检测到作者身份</span>
              )}
            </div>
            <div className="text-[11px] text-[#64748b]">
              配置 Windows / WSL2 全局 `user.name`、`user.email`、`pull.rebase`、`core.autocrlf`、SSH 密钥及签名选项。
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenGitConfig("global");
                }}
                className="px-3 py-1.5 rounded-md bg-white border border-[#cbd5e1] hover:bg-[#f1f5f9] text-[12px] font-medium text-[#0b1c30] cursor-pointer"
              >
                打开 Git 全局配置...
              </button>
              {hasActiveRepo && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenGitConfig("local");
                  }}
                  className="px-3 py-1.5 rounded-md bg-white border border-[#cbd5e1] hover:bg-[#f1f5f9] text-[12px] font-medium text-[#334155] cursor-pointer"
                >
                  打开当前仓库配置...
                </button>
              )}
            </div>
          </section>

          {/* Section 4: 软件更新 */}
          <section className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc]/70 p-3.5 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-semibold text-[#0b1c30] text-[13px]">
                <Sparkles className="w-4 h-4 text-[#0284c7]" />
                <span>软件更新 (GitHub Releases)</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-white border border-[#e2e8f0] text-[#0b1c30]">
                  当前版本 v{updateStatus.currentVersion}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onOpenRelease(avail?.releaseUrl || updateStatus.releasesUrl)
                  }
                  className="flex items-center gap-1 text-[11px] text-[#0284c7] hover:underline cursor-pointer"
                >
                  <span>Releases</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            </div>

            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <div>
                <div className="font-medium text-[#0b1c30]">
                  启动时自动检查更新
                </div>
                <div className="text-[11px] text-[#64748b]">
                  每次打开软件时后台静默检测 GitHub Releases 新版本并提示下载安装
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.autoCheckUpdates}
                onChange={(e) =>
                  onUpdateSettings({ autoCheckUpdates: e.target.checked })
                }
                className="w-4 h-4 accent-[#0284c7] cursor-pointer shrink-0"
              />
            </label>

            {updateStatus.state === "up-to-date" && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-[#f0fdf4] border border-[#bbf7d0] text-[#15803d] text-[12px]">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>当前已是最新版本 (v{updateStatus.currentVersion})。</span>
              </div>
            )}

            {updateStatus.state === "error" && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-[#fef2f2] border border-[#fecaca] text-[#dc2626] text-[12px]">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="min-w-0 break-words">
                  {updateStatus.errorMessage || "检查或下载更新失败"}
                </div>
              </div>
            )}

            {avail && (
              <div className="rounded-md border border-[#bae6fd] bg-white p-2.5 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="px-2 py-0.5 rounded-full bg-[#0284c7] text-white font-mono text-[11px] font-semibold">
                      v{avail.version}
                    </span>
                    <span className="font-semibold text-[#0b1c30] truncate">
                      {avail.name}
                    </span>
                  </div>
                  {avail.publishedAt && (
                    <span className="text-[11px] font-mono text-[#64748b] shrink-0">
                      {avail.publishedAt}
                    </span>
                  )}
                </div>
                {avail.assetName && (
                  <div className="text-[11px] font-mono text-[#475569]">
                    更新包：{avail.assetName}
                    {avail.assetSize > 0
                      ? ` (${formatBytes(avail.assetSize)})`
                      : ""}
                  </div>
                )}
                {avail.notes && (
                  <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap text-[11px] font-mono text-[#334155] bg-[#f8fafc] border border-[#e2e8f0] rounded p-2">
                    {avail.notes}
                  </pre>
                )}
                {!updateStatus.canSelfUpdate && (
                  <div className="text-[11px] text-[#b45309] bg-[#fffbeb] border border-[#fde68a] rounded px-2 py-1">
                    当前安装目录不可写，请前往 GitHub Releases 下载安装包覆盖安装。
                  </div>
                )}
              </div>
            )}

            {isUpdateBusy && (
              <div className="flex flex-col gap-1.5 px-3 py-2 rounded-md bg-white border border-[#e2e8f0]">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="flex items-center gap-1.5 font-medium text-[#0b1c30]">
                    <RefreshCw className="w-3.5 h-3.5 text-[#0284c7] animate-spin" />
                    {stageLabel}
                  </span>
                  {updateStatus.totalBytes > 0 && (
                    <span className="font-mono text-[11px] text-[#64748b]">
                      {formatBytes(updateStatus.downloadedBytes)} /{" "}
                      {formatBytes(updateStatus.totalBytes)}
                    </span>
                  )}
                </div>
                {(updateStatus.state === "downloading" ||
                  updateStatus.state === "verifying" ||
                  updateStatus.state === "installing") && (
                  <div className="w-full h-2 rounded-full bg-[#e2e8f0] overflow-hidden">
                    <div
                      className="h-full bg-[#0284c7] transition-all duration-150"
                      style={{
                        width: `${Math.max(4, updateStatus.percent)}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {updateStatus.state === "ready" && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-[#f0fdf4] border border-[#bbf7d0] text-[#15803d] text-[12px]">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>新版本已下载并校验完成，点击右侧“立即重启并安装”即可完成更新。</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {updateStatus.state !== "ready" && (
                <button
                  type="button"
                  onClick={onCheckUpdate}
                  disabled={isUpdateBusy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-[#cbd5e1] hover:bg-[#f1f5f9] text-[12px] font-medium text-[#0b1c30] disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${
                      updateStatus.state === "checking" ? "animate-spin" : ""
                    }`}
                  />
                  立即检查更新
                </button>
              )}

              {avail &&
                updateStatus.state !== "ready" &&
                (updateStatus.canSelfUpdate ? (
                  <button
                    type="button"
                    onClick={onDownloadUpdate}
                    disabled={isUpdateBusy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#0284c7] hover:bg-[#0369a1] text-white text-[12px] font-medium disabled:opacity-50 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    下载并安装更新
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      onOpenRelease(
                        avail.releaseUrl || updateStatus.releasesUrl
                      )
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#0284c7] hover:bg-[#0369a1] text-white text-[12px] font-medium cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    前往 GitHub 下载
                  </button>
                ))}

              {updateStatus.state === "ready" && (
                <button
                  type="button"
                  onClick={onRestartUpdate}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#16a34a] hover:bg-[#15803d] text-white text-[12px] font-medium cursor-pointer"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  立即重启并安装
                </button>
              )}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 bg-[#f8fafc] border-t border-[#e2e8f0] flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-md bg-[#0284c7] hover:bg-[#0369a1] text-white text-[12px] font-medium cursor-pointer"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
