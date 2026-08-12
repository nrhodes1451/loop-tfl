import Link from "next/link";
import { disruptionStationSummary, type NetworkIndex } from "@/lib/plan";
import { loop } from "@/lib/tokens";
import type { DisruptionPayload, NetworkStation } from "@/lib/types";

export function RouteEntry({
  index,
  from,
  to,
  disruptions,
  onOpenPicker,
  onSwap,
  onPlan,
  onOpenDisruptions,
}: {
  index: NetworkIndex;
  from: NetworkStation | null;
  to: NetworkStation | null;
  disruptions: DisruptionPayload | null;
  onOpenPicker: (slot: "from" | "to") => void;
  onSwap: () => void;
  onPlan: () => void;
  onOpenDisruptions: () => void;
}) {
  const canPlan = Boolean(from && to && from.id !== to.id);
  const summary = disruptionStationSummary(index, disruptions);

  return (
    <div className="flex min-h-full flex-col">
      <header style={{ padding: "22px 20px 0" }}>
        <div className="flex flex-wrap items-baseline gap-[9px]">
          <div
            style={{
              fontSize: 27,
              fontWeight: 700,
              letterSpacing: "-0.03em",
              color: loop.text,
            }}
          >
            Loop
          </div>
          <div
            className="font-[family-name:var(--font-ibm-plex-mono)]"
            style={{ fontSize: 10, color: loop.label, letterSpacing: "0.04em" }}
          >
            london · live lift status
          </div>
        </div>
        <p
          className="m-0"
          style={{ marginTop: 6, fontSize: 11.5, color: loop.faint }}
        >
          Unofficial. Not affiliated with TfL.
        </p>
      </header>

      <div
        className="flex flex-1 flex-col"
        style={{ padding: "26px 20px 0", gap: 14 }}
      >
        <h2
          className="m-0"
          style={{
            fontSize: 19,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: loop.text,
          }}
        >
          Plan a step-free journey
        </h2>

        <div
          className="flex"
          style={{
            background: loop.panel,
            border: `1px solid ${loop.hairline}`,
            borderRadius: 16,
            padding: "6px 6px 6px 0",
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <StationSlot
              slot="from"
              station={from}
              onClick={() => onOpenPicker("from")}
            />
            <div
              style={{
                height: 1,
                background: loop.hairline,
                marginLeft: 46,
              }}
            />
            <StationSlot
              slot="to"
              station={to}
              onClick={() => onOpenPicker("to")}
            />
          </div>
          <button
            type="button"
            aria-label="Swap start and destination"
            onClick={onSwap}
            className="cursor-pointer self-stretch"
            style={{
              width: 46,
              background: loop.raised,
              border: `1px solid ${loop.hairline}`,
              borderRadius: 12,
              fontSize: 17,
              color: loop.text,
            }}
          >
            ⇅
          </button>
        </div>

        {!from && !to ? (
          <div
            className="text-center"
            style={{
              border: "1px dashed rgba(0,0,0,.13)",
              borderRadius: 14,
              padding: "20px 18px",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: loop.text }}>
              No journeys yet
            </div>
            <p
              className="m-0"
              style={{
                marginTop: 6,
                fontSize: 12.5,
                color: loop.label,
                lineHeight: 1.5,
              }}
            >
              Pick a destination and Loop checks every lift and ramp on the way —
              street to street.
            </p>
          </div>
        ) : null}

        <DisruptionCard summary={summary} onOpen={onOpenDisruptions} />

        <div className="mt-auto" />
      </div>

      <div
        style={{
          padding: "14px 20px 12px",
          paddingBottom: "max(12px, env(safe-area-inset-bottom))",
          background: "linear-gradient(to top, #f7f8f9 60%, rgba(247,248,249,0))",
        }}
      >
        {!canPlan && (
          <p
            className="m-0 text-center"
            style={{ marginBottom: 8, fontSize: 12, color: loop.label }}
          >
            Choose a destination to continue
          </p>
        )}
        <button
          type="button"
          disabled={!canPlan}
          onClick={onPlan}
          className="w-full"
          style={{
            minHeight: 54,
            borderRadius: 15,
            border: "none",
            background: canPlan ? loop.text : loop.disabled,
            color: canPlan ? "#ffffff" : loop.label,
            fontSize: 16.5,
            fontWeight: 600,
            cursor: canPlan ? "pointer" : "not-allowed",
          }}
        >
          Plan step-free route
        </button>
        <div className="mt-3 text-center">
          <Link
            href="/explore"
            style={{
              fontSize: 12.5,
              color: loop.muted,
              borderBottom: "1px solid rgba(0,0,0,.15)",
              textDecoration: "none",
            }}
          >
            Explore the network graph
          </Link>
        </div>
      </div>
    </div>
  );
}

function StationSlot({
  slot,
  station,
  onClick,
}: {
  slot: "from" | "to";
  station: NetworkStation | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center text-left"
      style={{
        minHeight: 60,
        padding: "0 8px 0 18px",
        gap: 14,
        borderRadius: 12,
        border: "none",
        background: "transparent",
        color: loop.text,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 14,
          height: 14,
          flexShrink: 0,
          boxSizing: "border-box",
          border: `3px solid ${loop.label}`,
          borderRadius: slot === "from" ? 99 : 3,
        }}
      />
      <span className="min-w-0">
        <span
          className="block font-[family-name:var(--font-ibm-plex-mono)]"
          style={{
            fontSize: 9.5,
            color: loop.label,
            letterSpacing: "0.08em",
          }}
        >
          {slot === "from" ? "FROM" : "TO"}
        </span>
        <span
          className="block truncate"
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: station ? loop.text : loop.placeholder,
          }}
        >
          {station?.name ?? "Choose a station"}
        </span>
      </span>
    </button>
  );
}

function DisruptionCard({
  summary,
  onOpen,
}: {
  summary: ReturnType<typeof disruptionStationSummary>;
  onOpen: () => void;
}) {
  const clickable = Boolean(summary && !("error" in summary) && summary.count > 0);
  const body = (
    <>
      {!summary ? (
        <div style={{ fontSize: 14, fontWeight: 600, color: loop.label }}>
          Checking live lift status…
        </div>
      ) : "error" in summary ? (
        <div style={{ fontSize: 14, fontWeight: 600, color: loop.brk }}>
          Live feed unavailable
          <div
            style={{
              marginTop: 4,
              fontSize: 12.5,
              fontWeight: 400,
              color: loop.muted,
            }}
          >
            {summary.error}. Statuses will be marked unknown.
          </div>
        </div>
      ) : summary.count === 0 ? (
        <div className="flex items-center" style={{ gap: 10 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 99,
              background: loop.ok,
              flexShrink: 0,
            }}
          />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: loop.text }}>
              No lift outages reported
            </div>
            <div style={{ fontSize: 12.5, color: loop.muted }}>
              Live feed is up. Outages appear here as TfL reports them.
            </div>
          </div>
        </div>
      ) : (
        <div className="flex w-full items-center" style={{ gap: 10 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 99,
              background: loop.brk,
              flexShrink: 0,
            }}
          />
          <div className="min-w-0 flex-1 text-left">
            <div style={{ fontSize: 14, fontWeight: 600, color: loop.text }}>
              {summary.count} lift{summary.count === 1 ? "" : "s"} out of service
            </div>
            <div style={{ fontSize: 12.5, color: loop.muted }}>
              {formatNames(summary.names)}
            </div>
          </div>
          <span aria-hidden style={{ fontSize: 20, color: loop.label, lineHeight: 1 }}>
            ›
          </span>
        </div>
      )}
    </>
  );

  return (
    <div>
      <div
        className="font-[family-name:var(--font-ibm-plex-mono)]"
        style={{
          fontSize: 9.5,
          color: loop.label,
          letterSpacing: "0.08em",
          marginBottom: 8,
        }}
      >
        LIFT DISRUPTIONS NOW
      </div>
      {clickable ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Show all ${summary && !("error" in summary) ? summary.count : ""} lifts out of service`}
          className="w-full cursor-pointer text-left"
          style={{
            background: loop.panel,
            border: `1px solid ${loop.hairline}`,
            borderRadius: 14,
            padding: "14px 16px",
            minHeight: 44,
            color: loop.text,
          }}
        >
          {body}
        </button>
      ) : (
        <div
          style={{
            background: loop.panel,
            border: `1px solid ${loop.hairline}`,
            borderRadius: 14,
            padding: "14px 16px",
          }}
        >
          {body}
        </div>
      )}
    </div>
  );
}

function formatNames(names: string[]): string {
  if (names.length === 0) return "Stations updating…";
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
}
