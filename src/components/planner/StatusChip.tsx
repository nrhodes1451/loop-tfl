import type { CSSProperties } from "react";
import type { LiftStatus } from "@/lib/types";
import { plannerStatusLabel } from "@/lib/status";
import { loop } from "@/lib/tokens";

export function StatusChip({ status }: { status: LiftStatus }) {
  const label = plannerStatusLabel(status);
  const wrap: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 8,
    fontSize: 11.5,
    fontWeight: 600,
    flexShrink: 0,
    whiteSpace: "nowrap",
  };
  const shape: CSSProperties = {
    width: 8,
    height: 8,
    flexShrink: 0,
  };

  if (status === "ok") {
    return (
      <span style={{ ...wrap, background: loop.okBg, color: loop.ok }}>
        <span style={{ ...shape, borderRadius: 99, background: loop.ok }} />
        {label}
      </span>
    );
  }
  if (status === "partial") {
    return (
      <span
        style={{
          ...wrap,
          background: loop.panel,
          color: loop.muted,
          border: "1px solid rgba(20,23,28,.2)",
        }}
      >
        <span
          style={{
            ...shape,
            borderRadius: 99,
            background: `linear-gradient(90deg, ${loop.muted} 50%, transparent 50%)`,
            border: `1px solid ${loop.muted}`,
            boxSizing: "border-box",
          }}
        />
        {label}
      </span>
    );
  }
  if (status === "bad") {
    return (
      <span style={{ ...wrap, background: loop.brkBg, color: loop.brk }}>
        <span style={{ ...shape, borderRadius: 2, background: loop.brk }} />
        {label}
      </span>
    );
  }
  if (status === "unknown") {
    return (
      <span style={{ ...wrap, background: loop.unknownBg, color: loop.unknownText }}>
        <span style={{ ...shape, borderRadius: 99, background: loop.unknown }} />
        {label}
      </span>
    );
  }
  return (
    <span
      style={{
        ...wrap,
        background: "transparent",
        color: loop.muted,
        border: `1px dashed ${loop.dashed}`,
      }}
    >
      <span
        style={{
          ...shape,
          borderRadius: 99,
          border: `1px dashed ${loop.muted}`,
          boxSizing: "border-box",
        }}
      />
      {label}
    </span>
  );
}
