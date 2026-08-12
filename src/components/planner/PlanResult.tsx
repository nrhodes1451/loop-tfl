import type { CSSProperties } from "react";
import type { PlanResult } from "@/lib/plan";
import { formatDistanceM, type NetworkIndex } from "@/lib/plan";
import { loop } from "@/lib/tokens";
import type { NetworkStation } from "@/lib/types";
import { PlanningProgress } from "./PlanningProgress";
import { Timeline } from "./Timeline";
import { VerdictBanner } from "./VerdictBanner";

export function PlanResult({
  index,
  from,
  to,
  plan,
  planning,
  liftsChecked,
  liftsTotal,
  onBack,
  onEdit,
  onCancel,
  onRefresh,
  onReplanAvoiding,
  onPlanToAlternative,
  onPickDestination,
}: {
  index: NetworkIndex;
  from: NetworkStation;
  to: NetworkStation;
  plan: PlanResult | null;
  planning: boolean;
  liftsChecked: number;
  liftsTotal: number;
  onBack: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onRefresh: () => void;
  onReplanAvoiding: (stationId: string) => void;
  onPlanToAlternative: (stationId: string) => void;
  onPickDestination: () => void;
}) {
  const subtitle = headerSubtitle(plan, planning);

  return (
    <div className="flex min-h-full flex-col" style={{ background: loop.page }}>
      <header
        className="sticky top-0 z-10 flex items-center"
        style={{
          background: loop.panel,
          borderBottom: `1px solid ${loop.hairline}`,
          padding: "4px 16px 12px",
          gap: 12,
          paddingTop: "max(4px, env(safe-area-inset-top))",
        }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="cursor-pointer"
          style={{
            width: 38,
            height: 38,
            borderRadius: 11,
            background: loop.raised,
            border: "none",
            fontSize: 20,
            color: loop.text,
            flexShrink: 0,
          }}
        >
          ‹
        </button>
        <div className="min-w-0 flex-1">
          <div
            className="truncate"
            style={{ fontSize: 14.5, fontWeight: 600, color: loop.text }}
          >
            {from.name} → {to.name}
          </div>
          <div
            className="font-[family-name:var(--font-ibm-plex-mono)]"
            style={{ fontSize: 10, color: loop.label }}
          >
            {subtitle}
          </div>
        </div>
        {!planning && (
          <button
            type="button"
            onClick={onEdit}
            className="cursor-pointer"
            style={{
              minHeight: 36,
              padding: "0 12px",
              borderRadius: 10,
              background: loop.raised,
              border: "none",
              fontSize: 13,
              fontWeight: 600,
              color: loop.text,
            }}
          >
            Edit
          </button>
        )}
      </header>

      <div
        className="flex min-h-0 flex-1 flex-col"
        style={{ padding: "20px 20px 0" }}
      >
        {planning || !plan ? (
          <PlanningProgress
            liftsChecked={liftsChecked}
            liftsTotal={liftsTotal}
            onCancel={onCancel}
          />
        ) : (
          <ResultBody
            index={index}
            to={to}
            plan={plan}
            onRefresh={onRefresh}
            onReplanAvoiding={onReplanAvoiding}
            onPlanToAlternative={onPlanToAlternative}
            onPickDestination={onPickDestination}
          />
        )}
      </div>
    </div>
  );
}

function ResultBody({
  index,
  to,
  plan,
  onRefresh,
  onReplanAvoiding,
  onPlanToAlternative,
  onPickDestination,
}: {
  index: NetworkIndex;
  to: NetworkStation;
  plan: PlanResult;
  onRefresh: () => void;
  onReplanAvoiding: (stationId: string) => void;
  onPlanToAlternative: (stationId: string) => void;
  onPickDestination: () => void;
}) {
  const changeCount = plan.legs.filter((l) => l.kind === "change").length;
  const okBody =
    changeCount === 0
      ? `Street to street. Direct, ${plan.liftsTotal} lift${plan.liftsTotal === 1 ? "" : "s"}, all in service.`
      : `Street to street. ${changeCount} change${changeCount === 1 ? "" : "s"}, ${plan.liftsTotal} lift${plan.liftsTotal === 1 ? "" : "s"}, all in service.`;

  const breakStation = plan.breakAt
    ? index.stationById.get(plan.breakAt)?.name
    : undefined;
  const breakLeg = plan.legs.find((l) => l.status === "broken" && l.kind === "change");

  const unknownCount = plan.legs.filter((l) => l.status === "unknown").length;

  const bannerTitle =
    plan.status === "break" && breakStation
      ? `Step-free route breaks at ${breakStation}`
      : undefined;
  const bannerBody =
    plan.status === "ok"
      ? okBody
      : plan.status === "break"
        ? breakLeg?.detail
        : plan.status === "uncertain"
          ? `The path exists on paper, but live lift status is missing for ${unknownCount || "some"} lift${unknownCount === 1 ? "" : "s"}. Treat with care.`
          : `${to.name} has no step-free path between street and platform. This is permanent, not a lift fault.`;

  const timelineLabel =
    plan.status === "break"
      ? "ATTEMPTED ROUTE"
      : plan.status === "none"
        ? "WHERE IT STOPS"
        : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <VerdictBanner status={plan.status} title={bannerTitle} body={bannerBody} />

      <div className="min-h-0 flex-1 overflow-auto" style={{ paddingTop: 20 }}>
        <Timeline legs={plan.legs} label={timelineLabel} />

        {plan.status === "none" && plan.alternative && (
          <div
            style={{
              marginTop: 16,
              background: loop.panel,
              border: `1px solid ${loop.hairline}`,
              borderRadius: 14,
              padding: "14px 16px",
            }}
          >
            <div
              className="font-[family-name:var(--font-ibm-plex-mono)]"
              style={{
                fontSize: 9.5,
                color: loop.label,
                letterSpacing: "0.08em",
              }}
            >
              NEAREST STEP-FREE ALTERNATIVE
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 15.5,
                fontWeight: 600,
                color: loop.text,
              }}
            >
              {plan.alternative.name}
            </div>
            <p className="m-0" style={{ marginTop: 4, fontSize: 13, color: loop.muted, lineHeight: 1.5 }}>
              Step-free throughout · {formatDistanceM(plan.alternative.distanceM)} from{" "}
              {to.name}.
            </p>
          </div>
        )}
      </div>

      <Actions
        plan={plan}
        breakName={
          plan.breakAt
            ? (index.stationById.get(plan.breakAt)?.name ?? "this station")
            : undefined
        }
        onRefresh={onRefresh}
        onReplanAvoiding={onReplanAvoiding}
        onPlanToAlternative={onPlanToAlternative}
        onPickDestination={onPickDestination}
      />
    </div>
  );
}

function Actions({
  plan,
  breakName,
  onRefresh,
  onReplanAvoiding,
  onPlanToAlternative,
  onPickDestination,
}: {
  plan: PlanResult;
  breakName?: string;
  onRefresh: () => void;
  onReplanAvoiding: (stationId: string) => void;
  onPlanToAlternative: (stationId: string) => void;
  onPickDestination: () => void;
}) {
  const pad = {
    padding: "14px 0 12px",
    paddingBottom: "max(12px, env(safe-area-inset-bottom))",
  };

  if (plan.status === "ok") {
    return (
      <div className="flex" style={{ ...pad, gap: 10 }}>
        <button
          type="button"
          onClick={onRefresh}
          className="flex-1 cursor-pointer"
          style={primaryBtn}
        >
          Start journey
        </button>
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Refresh lift status"
          className="cursor-pointer"
          style={{
            width: 54,
            height: 54,
            borderRadius: 15,
            background: loop.raised,
            border: "1px solid rgba(0,0,0,.13)",
            fontSize: 20,
            color: loop.text,
          }}
        >
          ↻
        </button>
      </div>
    );
  }

  if (plan.status === "break") {
    return (
      <div className="flex flex-col" style={{ ...pad, gap: 8 }}>
        <button
          type="button"
          onClick={() => plan.breakAt && onReplanAvoiding(plan.breakAt)}
          disabled={!plan.breakAt}
          className="w-full cursor-pointer"
          style={primaryBtn}
        >
          Replan avoiding {breakName ?? "this station"}
        </button>
      </div>
    );
  }

  if (plan.status === "uncertain") {
    return (
      <div style={pad}>
        <button
          type="button"
          onClick={onRefresh}
          className="w-full cursor-pointer"
          style={primaryBtn}
        >
          Retry live check
        </button>
        <p
          className="m-0 text-center"
          style={{ marginTop: 10, fontSize: 11.5, color: loop.faint }}
        >
          Unofficial tool. Call TfL 0343 222 1234 to confirm lifts before travelling.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ ...pad, gap: 8 }}>
      {plan.alternative && (
        <button
          type="button"
          onClick={() => onPlanToAlternative(plan.alternative!.stationId)}
          className="w-full cursor-pointer"
          style={primaryBtn}
        >
          Plan to {plan.alternative.name}
        </button>
      )}
      <button
        type="button"
        onClick={onPickDestination}
        className="w-full cursor-pointer"
        style={secondaryBtn}
      >
        Pick a different destination
      </button>
    </div>
  );
}

const primaryBtn: CSSProperties = {
  minHeight: 54,
  borderRadius: 15,
  background: loop.text,
  color: "#ffffff",
  fontSize: 16.5,
  fontWeight: 600,
  border: "none",
};

const secondaryBtn: CSSProperties = {
  minHeight: 48,
  borderRadius: 14,
  background: loop.raised,
  color: loop.text,
  fontSize: 15,
  fontWeight: 600,
  border: "1px solid rgba(0,0,0,.13)",
};

function headerSubtitle(plan: PlanResult | null, planning: boolean): string {
  if (planning || !plan) return "checking live lift status…";
  const time = plan.checkedAt
    ? new Date(plan.checkedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  if (plan.status === "none") return "structural · not a disruption";
  if (plan.status === "uncertain") {
    const ago = plan.checkedAt ? minutesAgo(plan.checkedAt) : null;
    if (ago != null && time) return `last live check ${time} · ${ago}`;
    return "live lift status missing";
  }
  if (plan.status === "break") {
    return time
      ? `checked ${time} · 1 lift out of service`
      : "1 lift out of service";
  }
  const n = plan.liftsTotal;
  return time
    ? `checked ${time} · ${n} lift${n === 1 ? "" : "s"} on route`
    : `${n} lift${n === 1 ? "" : "s"} on route`;
}

function minutesAgo(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 1) return "just now";
  return `${min} min ago`;
}
