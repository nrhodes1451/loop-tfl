import type { CSSProperties } from "react";
import type { Leg, LegNode, LegStatus } from "@/lib/plan";
import { colors, loop } from "@/lib/tokens";

const LIFT_BLUE = "#2563eb";

function liftCircle(status: LegStatus, breakMark: boolean): string {
  if (status === "broken") return breakMark ? loop.brk : "rgba(20,23,28,.28)";
  if (status === "unknown" || status === "none") return colors.unknown;
  return LIFT_BLUE;
}

function LiftIcon() {
  return (
    <svg width="12" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="5"
        y="2.5"
        width="14"
        height="19"
        rx="2"
        stroke="#ffffff"
        strokeWidth="2.4"
      />
      <path d="M12 6.5l3.2 3.4H8.8L12 6.5z" fill="#ffffff" />
      <path d="M12 17.5l-3.2-3.4h6.4L12 17.5z" fill="#ffffff" />
    </svg>
  );
}

function Node({
  node,
  status,
  breakMark,
}: {
  node: LegNode;
  status: LegStatus;
  breakMark: boolean;
}) {
  const none = status === "none";
  const unreachable = status === "broken" && !breakMark;

  if (node.type === "street") {
    const dashed = none || unreachable;
    return (
      <span
        aria-hidden
        className="relative inline-flex items-center justify-center"
        style={{
          width: 22,
          height: 22,
          flexShrink: 0,
          borderRadius: 99,
          background: dashed ? "transparent" : loop.ok,
          border: dashed ? "4px dashed rgba(20,23,28,.55)" : "none",
          boxSizing: "border-box",
        }}
      >
        {!dashed && (
          <svg width="12" height="12" viewBox="0 0 7 7" fill="none">
            <path
              d="M2.6 0h1.8v3.2h1.7L3.5 7.2 0.9 3.2h1.7V0z"
              fill="#ffffff"
            />
          </svg>
        )}
      </span>
    );
  }

  if (node.type === "lift") {
    const dashed = none || unreachable;
    return (
      <span
        aria-hidden
        className="inline-flex items-center justify-center"
        style={{
          width: 22,
          height: 22,
          flexShrink: 0,
          borderRadius: 99,
          background: dashed ? "transparent" : liftCircle(status, breakMark),
          border: dashed ? "4px dashed rgba(20,23,28,.55)" : "none",
          boxShadow: breakMark ? "0 0 0 4px rgba(209,37,46,.2)" : undefined,
          boxSizing: "border-box",
        }}
      >
        {!dashed && <LiftIcon />}
      </span>
    );
  }

  const line = node.lineColor ?? loop.label;
  const lineStyle: CSSProperties = {
    width: 22,
    height: 22,
    flexShrink: 0,
    borderRadius: 99,
    background: "#ffffff",
    border:
      none || unreachable
        ? "4px dashed rgba(20,23,28,.55)"
        : `4px solid ${line}`,
    boxSizing: "border-box",
  };

  return <span aria-hidden style={lineStyle} />;
}

function Gutter({
  from,
  to,
  status,
  breakMark,
  showFrom,
  showTo,
}: {
  from: LegNode;
  to: LegNode;
  status: LegStatus;
  breakMark: boolean;
  showFrom: boolean;
  showTo: boolean;
}) {
  const dashed = status === "broken" || status === "none";
  const lineCol =
    (from.type === "line" ? from.lineColor : undefined) ??
    (to.type === "line" ? to.lineColor : undefined);
  const connectorColor = lineCol ?? loop.ok;

  return (
    <div
      className="flex flex-col items-center"
      style={{ width: 22, alignSelf: "stretch" }}
    >
      {showFrom && <Node node={from} status={status} breakMark={breakMark} />}
      <span
        className="flex-1"
        style={{
          width: 5,
          borderRadius: 3,
          marginTop: showFrom ? 5 : 0,
          marginBottom: 5,
          minHeight: 16,
          background: dashed
            ? "repeating-linear-gradient(to bottom, rgba(20,23,28,.28) 0 6px, transparent 6px 12px)"
            : connectorColor,
          opacity: dashed ? 1 : 0.95,
        }}
      />
      {showTo && <Node node={to} status={status} breakMark={breakMark} />}
    </div>
  );
}

function Chip({ chip }: { chip: NonNullable<Leg["chip"]> }) {
  const tone =
    chip.tone === "ok"
      ? { bg: loop.okBg, color: loop.ok }
      : chip.tone === "break"
        ? { bg: loop.brkBg, color: loop.brk }
        : { bg: loop.unknownBg, color: loop.unknownText };
  return (
    <span
      style={{
        display: "inline-block",
        marginTop: 9,
        padding: "6px 10px",
        borderRadius: 8,
        fontSize: 11.5,
        fontWeight: 600,
        background: tone.bg,
        color: tone.color,
      }}
    >
      {chip.label}
    </span>
  );
}

export function LegRow({
  leg,
  last,
}: {
  leg: Leg;
  previous: Leg | null;
  last: boolean;
}) {
  const dim = leg.kind === "unreachable";
  const breakMark =
    leg.status === "broken" && (leg.kind === "change" || leg.kind === "lift");
  const callout = breakMark;
  const dashedCard =
    leg.status === "none" &&
    (leg.kind === "arrive" || leg.kind === "change" || leg.kind === "start");
  const showFrom = true;
  const showTo =
    last &&
    (leg.fromNode.type !== leg.toNode.type ||
      leg.fromNode.lineId !== leg.toNode.lineId);

  return (
    <li
      className="flex"
      style={{
        gap: 14,
        opacity: dim ? 0.45 : 1,
        listStyle: "none",
      }}
    >
      <Gutter
        from={leg.fromNode}
        to={leg.toNode}
        status={leg.status}
        breakMark={breakMark}
        showFrom={showFrom}
        showTo={showTo}
      />
      <div
        className="min-w-0 flex-1"
        style={{ color: loop.text, paddingBottom: last ? 0 : 24 }}
      >
        {callout || dashedCard ? (
          <div
            style={{
              background: callout ? loop.raised : loop.panel,
              border: callout
                ? "1px solid rgba(209,37,46,.4)"
                : "1px dashed rgba(20,23,28,.32)",
              borderRadius: 14,
              padding: "14px 15px",
            }}
          >
            <div
              style={{
                fontSize: 15.5,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                color: callout ? loop.brk : loop.text,
              }}
            >
              {leg.title}
            </div>
            {leg.detail ? (
              <p
                className="m-0"
                style={{
                  marginTop: 4,
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: loop.muted,
                }}
              >
                {leg.detail}
              </p>
            ) : null}
            {leg.footnote && (
              <div
                className="font-[family-name:var(--font-ibm-plex-mono)]"
                style={{
                  marginTop: 8,
                  fontSize: 10,
                  color: loop.muted,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                {leg.footnote}
              </div>
            )}
            {leg.chip && <Chip chip={leg.chip} />}
          </div>
        ) : (
          <>
            <div
              style={{
                fontSize: 15.5,
                fontWeight: 600,
                letterSpacing: "-0.01em",
              }}
            >
              {leg.title}
            </div>
            {leg.detail ? (
              <p
                className="m-0"
                style={{
                  marginTop: 4,
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: loop.muted,
                }}
              >
                {leg.detail}
              </p>
            ) : null}
            {leg.chip && <Chip chip={leg.chip} />}
          </>
        )}
      </div>
    </li>
  );
}
