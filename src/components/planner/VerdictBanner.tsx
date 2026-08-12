import type { CSSProperties } from "react";
import type { PlanStatus } from "@/lib/plan";
import { loop } from "@/lib/tokens";

const COPY: Record<
  PlanStatus,
  { title: string; fallback: string }
> = {
  ok: {
    title: "Step-free throughout",
    fallback: "Street to street. Lifts on this path are in service.",
  },
  break: {
    title: "Step-free route breaks",
    fallback: "A lift on this path is out of service.",
  },
  uncertain: {
    title: "Probably step-free",
    fallback:
      "The path exists on paper, but live lift status is missing. Treat with care.",
  },
  none: {
    title: "No step-free route",
    fallback:
      "There is no step-free path between street and platform at the destination. This is permanent, not a lift fault.",
  },
};

export function VerdictBanner({
  status,
  title,
  body,
}: {
  status: PlanStatus;
  title?: string;
  body?: string;
}) {
  const copy = COPY[status];
  const heading = title ?? copy.title;
  const text = body ?? copy.fallback;

  let wrap: CSSProperties = {
    borderRadius: 16,
    padding: "16px 18px",
    display: "flex",
    gap: 13,
    alignItems: "flex-start",
  };
  let mark: CSSProperties = {
    width: 20,
    height: 20,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 800,
    color: "#ffffff",
    marginTop: 1,
  };
  let glyph = "";
  let titleColor: string = loop.text;

  if (status === "ok") {
    wrap = {
      ...wrap,
      background: loop.okBg,
      border: `1px solid ${loop.okBorder}`,
    };
    mark = { ...mark, borderRadius: 99, background: loop.ok };
    glyph = "✓";
    titleColor = loop.ok;
  } else if (status === "break") {
    wrap = {
      ...wrap,
      background: loop.brkBg,
      border: `1px solid ${loop.brkBorder}`,
    };
    mark = { ...mark, borderRadius: 4, background: loop.brk };
    glyph = "!";
    titleColor = loop.brk;
  } else if (status === "uncertain") {
    wrap = {
      ...wrap,
      background: loop.raised,
      border: "1px solid rgba(20,23,28,.16)",
    };
    mark = {
      ...mark,
      borderRadius: 99,
      background: "transparent",
      border: `3px solid ${loop.unknown}`,
      color: loop.unknown,
      fontSize: 11,
    };
    glyph = "?";
    titleColor = loop.text;
  } else {
    wrap = {
      ...wrap,
      background: loop.raised,
      border: "1px dashed rgba(20,23,28,.32)",
    };
    mark = {
      ...mark,
      borderRadius: 99,
      background: "transparent",
      border: "3px dashed rgba(20,23,28,.55)",
      color: loop.text,
    };
    glyph = "";
    titleColor = loop.text;
  }

  return (
    <div style={wrap}>
      <span style={mark} aria-hidden>
        {glyph}
      </span>
      <div>
        <h1
          className="m-0"
          style={{
            fontSize: 17.5,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: titleColor,
            lineHeight: 1.25,
          }}
        >
          {heading}
        </h1>
        <p
          className="m-0"
          style={{
            marginTop: 6,
            fontSize: 13,
            color: loop.body,
            lineHeight: 1.5,
          }}
        >
          {text}
        </p>
      </div>
    </div>
  );
}
