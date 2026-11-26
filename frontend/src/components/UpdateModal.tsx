import React from "react";
import {
  X,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RotateCw,
  Sparkles,
} from "lucide-react";
import type { UpdateStatus } from "../../bindings/gitpulse";
import { formatBytes } from "./StatusBadge";

interface UpdateModalProps {
  open: boolean;
  status: UpdateStatus;
  onClose: () => void;
  onCheck: () => void;
  onDownloadAndInstall: () => void;
  onRestart: () => void;
  onOpenRelease: (url: string) => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  open,
  status,
  onClose,
  onCheck,
  onDownloadAndInstall,
  onRestart,
  onOpenRelease,
}) => {
  if (!open) return null;

  const isBusy =
    status.state === "checking" ||
    status.state === "downloading" ||
    status.state === "verifying" ||
    status.state === "installing";

  const avail = status.available;

  const stageLabel =
    status.state === "checking"
      ? "正在检查 GitHub 最新版本..."
      : status.state === "downloading"
      ? `正在下载更新包 (${status.percent}%)...`
      : status.state === "verifying"
      ? "正在校验更新包 SHA-256 完整性..."
      : status.state === "installing"
      ? "正在准备安装文件..."
      : status.state === "ready"
      ? "更新已就绪，重启后立即生效"
      : "";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={() => {
        if (!isBusy) onClose();
      }}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white border border-[#cbd5e1] shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#0284c7]" />
            <h2 className="text-[14px] font-semibold text-[#0b1c30]">
              软件更新 (GitHub Releases)
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={isBusy}
            className="p-1 rounded hover:bg-[#e2e8f0] text-[#64748b] disabled:opacity-40 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col gap-3 text-[13px] text-[#334155]">
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#f8fafc] border border-[#e2e8f0]">
            <div>
              <div className="text-[11px] text-[#64748b]">当前版本</div>
              <div className="font-mono font-semibold text-[#0b1c30]">
                v{status.currentVersion}
              </div>
            </div>
            <button
              onClick={() =>
                onOpenRelease(avail?.releaseUrl || status.releasesUrl)
              }
              className="flex items-center gap-1 text-[12px] text-[#0284c7] hover:underline cursor-pointer"
            >
              <span>GitHub Releases</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>

          {status.state === "up-to-date" && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#f0fdf4] border border-[#bbf7d0] text-[#15803d] text-[12px]">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>当前已是最新版本 (v{status.currentVersion})。</span>
            </div>
          )}

          {status.state === "error" && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[#fef2f2] border border-[#fecaca] text-[#dc2626] text-[12px]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="min-w-0 break-words">
                {status.errorMessage || "检查或下载更新失败"}
              </div>
            </div>
          )}

          {avail && (
            <div className="rounded-lg border border-[#bae6fd] bg-[#f0f9ff]/60 p-3 flex flex-col gap-2">
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
                  包文件：{avail.assetName}
                  {avail.assetSize > 0 ? ` (${formatBytes(avail.assetSize)})` : ""}
                </div>
              )}

              {avail.notes && (
                <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap text-[12px] font-mono text-[#334155] bg-white border border-[#e2e8f0] rounded p-2.5 leading-relaxed">
                  {avail.notes}
                </pre>
              )}

              {!status.canSelfUpdate && (
                <div className="text-[11px] text-[#b45309] bg-[#fffbeb] border border-[#fde68a] rounded px-2.5 py-1.5">
                  当前安装目录不可写（例如位于 Program Files），请打开 GitHub Releases 下载安装包覆盖安装，或以管理员身份运行后更新。
                </div>
              )}
            </div>
          )}

          {isBusy && (
            <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded-lg bg-[#f8fafc] border border-[#e2e8f0]">
              <div className="flex items-center justify-between text-[12px]">
                <span className="flex items-center gap-1.5 font-medium text-[#0b1c30]">
                  <RefreshCw className="w-3.5 h-3.5 text-[#0284c7] animate-spin" />
                  {stageLabel}
                </span>
                {status.totalBytes > 0 && (
                  <span className="font-mono text-[11px] text-[#64748b]">
                    {formatBytes(status.downloadedBytes)} /{" "}
                    {formatBytes(status.totalBytes)}
                  </span>
                )}
              </div>
              {(status.state === "downloading" ||
                status.state === "verifying" ||
                status.state === "installing") && (
                <div className="w-full h-2 rounded-full bg-[#e2e8f0] overflow-hidden">
                  <div
                    className="h-full bg-[#0284c7] transition-all duration-150"
                    style={{ width: `${Math.max(4, status.percent)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {status.state === "ready" && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#f0fdf4] border border-[#bbf7d0] text-[#15803d] text-[12px]">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                新版本已下载并校验完成，点击“立即重启并安装”将自动替换程序并重新启动。
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-[#f8fafc] border-t border-[#e2e8f0] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={isBusy}
            className="px-3 py-1.5 rounded-md border border-[#cbd5e1] bg-white hover:bg-[#f1f5f9] text-[12px] font-medium text-[#334155] disabled:opacity-50 cursor-pointer"
          >
            关闭
          </button>

          {status.state !== "ready" && (
            <button
              onClick={onCheck}
              disabled={isBusy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#cbd5e1] bg-white hover:bg-[#f1f5f9] text-[12px] font-medium text-[#0b1c30] disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  status.state === "checking" ? "animate-spin" : ""
                }`}
              />
              检查更新
            </button>
          )}

          {avail &&
            status.state !== "ready" &&
            (status.canSelfUpdate ? (
              <button
                onClick={onDownloadAndInstall}
                disabled={isBusy}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[#0284c7] hover:bg-[#0369a1] text-white text-[12px] font-medium disabled:opacity-50 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                下载并安装更新
              </button>
            ) : (
              <button
                onClick={() =>
                  onOpenRelease(avail.releaseUrl || status.releasesUrl)
                }
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[#0284c7] hover:bg-[#0369a1] text-white text-[12px] font-medium cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                前往 GitHub 下载
              </button>
            ))}

          {status.state === "ready" && (
            <button
              onClick={onRestart}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[#16a34a] hover:bg-[#15803d] text-white text-[12px] font-medium cursor-pointer"
            >
              <RotateCw className="w-3.5 h-3.5" />
              立即重启并安装
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
