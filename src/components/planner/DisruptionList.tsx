import {
  groupDisruptedLifts,
  listDisruptedLifts,
  type NetworkIndex,
} from "@/lib/plan";
import { loop } from "@/lib/tokens";
import type { DisruptionPayload } from "@/lib/types";

export function DisruptionList({
  index,
  disruptions,
  onBack,
}: {
  index: NetworkIndex;
  disruptions: DisruptionPayload;
  onBack: () => void;
}) {
  const lifts = listDisruptedLifts(index, disruptions);
  const groups = groupDisruptedLifts(lifts);

  return (
    <div className="flex min-h-full flex-col" style={{ background: loop.page }}>
      <header
        className="flex items-center"
        style={{ padding: "12px 16px 8px", gap: 12 }}
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
        <div className="min-w-0">
          <div style={{ fontSize: 17, fontWeight: 600, color: loop.text }}>
            Lift disruptions
          </div>
          <div
            className="font-[family-name:var(--font-ibm-plex-mono)]"
            style={{ fontSize: 10, color: loop.label }}
          >
            {lifts.length} lift{lifts.length === 1 ? "" : "s"} out of service
          </div>
        </div>
      </header>

      <ul
        className="m-0 flex flex-1 flex-col overflow-auto p-0"
        style={{ gap: 10, padding: "12px 20px 24px" }}
      >
        {groups.map((group) => (
          <li key={group.stationId ?? group.stationName} className="list-none">
            <div
              style={{
                background: loop.panel,
                border: `1px solid ${loop.hairline}`,
                borderRadius: 14,
                padding: "14px 15px",
              }}
            >
              <div
                style={{
                  fontSize: 15.5,
                  fontWeight: 600,
                  letterSpacing: "-0.01em",
                  color: loop.text,
                }}
              >
                {group.stationName}
              </div>
              <div className="flex flex-col" style={{ gap: 12, marginTop: 10 }}>
                {group.lifts.map((lift) => (
                  <div key={lift.liftId} className="flex" style={{ gap: 10 }}>
                    <span
                      aria-hidden
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: loop.brk,
                        flexShrink: 0,
                        marginTop: 6,
                      }}
                    />
                    <div className="min-w-0">
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: loop.text,
                        }}
                      >
                        {lift.liftName}
                      </div>
                      <p
                        className="m-0"
                        style={{
                          marginTop: 3,
                          fontSize: 12.5,
                          lineHeight: 1.5,
                          color: loop.muted,
                        }}
                      >
                        {lift.message}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
