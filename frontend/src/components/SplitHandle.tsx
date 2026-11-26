import React, { useEffect, useRef, useState } from "react";

interface SplitHandleProps {
  direction: "horizontal" | "vertical";
  variant?: "gap" | "edge" | "divider";
  title?: string;
  onDragStart?: () => void;
  onDragMove: (dx: number, dy: number) => void;
  onDragEnd?: () => void;
  onReset?: () => void;
}

export const SplitHandle: React.FC<SplitHandleProps> = ({
  direction,
  variant = "gap",
  title = "Drag to resize · Double-click to reset",
  onDragStart,
  onDragMove,
  onDragEnd,
  onReset,
}) => {
  const [dragging, setDragging] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const callbacksRef = useRef({ onDragStart, onDragMove, onDragEnd });
  callbacksRef.current = { onDragStart, onDragMove, onDragEnd };

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;

    document.body.style.cursor =
      direction === "horizontal" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";

    setDragging(true);
    callbacksRef.current.onDragStart?.();

    const finish = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", finish);
      window.removeEventListener("blur", finish);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      cleanupRef.current = null;
      setDragging(false);
      callbacksRef.current.onDragEnd?.();
    };

    const handleMouseMove = (ev: MouseEvent) => {
      callbacksRef.current.onDragMove(ev.clientX - startX, ev.clientY - startY);
    };

    cleanupRef.current = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", finish);
      window.removeEventListener("blur", finish);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", finish);
    window.addEventListener("blur", finish);
  };

  const isHorizontal = direction === "horizontal";

  if (variant === "edge") {
    return (
      <div
        role="separator"
        aria-orientation="vertical"
        title={title}
        onMouseDown={handleMouseDown}
        onDoubleClick={onReset}
        className="group relative w-[5px] -ml-[2px] -mr-[2px] z-20 shrink-0 cursor-col-resize select-none flex items-center justify-center"
      >
        <div
          className={`h-full w-px transition-colors ${
            dragging
              ? "bg-[#0284c7] w-[2px]"
              : "bg-[#e2e8f0] group-hover:bg-[#0284c7] group-hover:w-[2px]"
          }`}
        />
      </div>
    );
  }

  if (variant === "divider") {
    return (
      <div
        role="separator"
        aria-orientation="horizontal"
        title={title}
        onMouseDown={handleMouseDown}
        onDoubleClick={onReset}
        className={`group relative h-[6px] shrink-0 cursor-row-resize select-none flex items-center justify-center transition-colors ${
          dragging ? "bg-[#e0f2fe]" : "bg-[#f8fafc] hover:bg-[#f1f5f9]"
        }`}
      >
        <div
          className={`absolute inset-x-0 top-1/2 -translate-y-1/2 h-px transition-colors ${
            dragging ? "bg-[#0284c7]" : "bg-[#e2e8f0] group-hover:bg-[#94a3b8]"
          }`}
        />
        <div
          className={`relative z-10 w-8 h-[3px] rounded-full transition-colors ${
            dragging
              ? "bg-[#0284c7]"
              : "bg-[#cbd5e1] group-hover:bg-[#0284c7]"
          }`}
        />
      </div>
    );
  }

  // "gap" variant: matches the 8px gap between rounded cards
  return (
    <div
      role="separator"
      aria-orientation={isHorizontal ? "vertical" : "horizontal"}
      title={title}
      onMouseDown={handleMouseDown}
      onDoubleClick={onReset}
      className={`group shrink-0 select-none flex items-center justify-center ${
        isHorizontal
          ? "w-2 cursor-col-resize"
          : "h-2 cursor-row-resize"
      }`}
    >
      <div
        className={`rounded-full transition-all ${
          isHorizontal
            ? dragging
              ? "w-[3px] h-12 bg-[#0284c7]"
              : "w-[2px] h-8 bg-transparent group-hover:bg-[#0284c7]/75"
            : dragging
            ? "h-[3px] w-14 bg-[#0284c7]"
            : "h-[2px] w-10 bg-transparent group-hover:bg-[#0284c7]/75"
        }`}
      />
    </div>
  );
};
