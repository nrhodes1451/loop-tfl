import type { CSSProperties } from "react";
import type { Leg } from "@/lib/plan";
import { loop } from "@/lib/tokens";

function Ring({
  kind,
  status,
  last,
}: {
  kind: Leg["kind"];
  status: Leg["status"];
  last: boolean;
}) {
  const broken = status === "broken";
  const none = status === "none";
  const unknown = status === "unknown";
  const pass = kind === "ride";

  let ring: CSSProperties = {
    width: pass ? 14 : 18,
    height: pass ? 14 : 18,
    flexShrink: 0,
    boxSizing: "border-box",
  };

  if (pass) {
    const color = broken || none ? "rgba(20,23,28,.28)" : (undefined as unknown as string);
    ring = {
      ...ring,
      borderRadius: 99,
      background: color ?? "currentColor",
      boxShadow: color ? undefined : "0 0 0 3px rgba(0,152,212,.25)",
    };
  } else if (broken && kind === "change") {
    ring = {
      ...ring,
      borderRadius: 4,
      background: loop.brk,
      boxShadow: "0 0 0 4px rgba(209,37,46,.2)",
    };
  } else if (none) {
    ring = {
      ...ring,
      borderRadius: 99,
      border: "4px dashed rgba(20,23,28,.55)",
      background: "transparent",
    };
  } else if (unknown) {
    ring = {
      ...ring,
      borderRadius: 99,
      border: `4px solid ${loop.unknown}`,
      background: "transparent",
    };
  } else if (kind === "unreachable") {
    ring = {
      ...ring,
      borderRadius: 99,
      border: "4px dashed rgba(20,23,28,.35)",
      background: "transparent",
    };
  } else {
    ring = {
      ...ring,
      borderRadius: 99,
      border: `4px solid ${loop.ok}`,
      background: "transparent",
    };
  }

  const dashed = broken || none || kind === "unreachable";
  const connectorColor = dashed
    ? undefined
    : kind === "arrive" || last
      ? "transparent"
      : undefined;

  return (
    <div
      className="flex flex-col items-center"
      style={{ width: 18, alignSelf: "stretch" }}
    >
      <span style={ring} />
      {!last && (
        <span
          className="flex-1"
          style={{
            width: 5,
            borderRadius: 3,
            margin: "5px 0",
            minHeight: 12,
            background: dashed
              ? "repeating-linear-gradient(to bottom, rgba(20,23,28,.28) 0 6px, transparent 6px 12px)"
              : connectorColor === "transparent"
                ? "transparent"
                : "currentColor",
            opacity: dashed ? 1 : 0.95,
          }}
        />
      )}
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
  last: boolean;
}) {
  const dim = leg.kind === "unreachable";
  const callout = leg.status === "broken" && leg.kind === "change";
  const dashedCard = leg.status === "none" && (leg.kind === "arrive" || leg.kind === "change");
  const color = leg.lineColor ?? loop.label;

  return (
    <li
      className="flex"
      style={{
        gap: 14,
        color,
        opacity: dim ? 0.45 : 1,
        paddingBottom: last ? 0 : 22,
        listStyle: "none",
      }}
    >
      <Ring kind={leg.kind} status={leg.status} last={last} />
      <div className="min-w-0 flex-1" style={{ color: loop.text }}>
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
            {leg.chip && <Chip chip={leg.chip} />}
          </>
        )}
      </div>
    </li>
  );
}
