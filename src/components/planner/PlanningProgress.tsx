import { loop } from "@/lib/tokens";

export function PlanningProgress({
  liftsChecked,
  liftsTotal,
  onCancel,
}: {
  liftsChecked: number;
  liftsTotal: number;
  onCancel: () => void;
}) {
  const pct =
    liftsTotal > 0 ? Math.min(100, Math.round((liftsChecked / liftsTotal) * 100)) : 32;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        style={{
          background: loop.raised,
          border: `1px solid rgba(0,0,0,.13)`,
          borderRadius: 16,
          padding: "16px 18px",
        }}
      >
        <div className="flex gap-[13px]" style={{ alignItems: "flex-start" }}>
          <span
            className="loop-spinner"
            style={{
              width: 20,
              height: 20,
              flexShrink: 0,
              borderRadius: 99,
              border: "3px solid rgba(20,23,28,.18)",
              borderTopColor: loop.text,
              boxSizing: "border-box",
              marginTop: 1,
            }}
          />
          <div className="min-w-0 flex-1">
            <div
              style={{
                fontSize: 17.5,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                color: loop.text,
              }}
            >
              Planning step-free route
            </div>
            <p
              className="m-0"
              style={{
                marginTop: 6,
                fontSize: 13,
                lineHeight: 1.5,
                color: loop.body,
              }}
            >
              {liftsTotal > 0
                ? `Walking the station graph, then checking ${liftsTotal} lifts on candidate paths.`
                : "Walking the station graph, then checking lifts on candidate paths."}
            </p>
            <div
              style={{
                marginTop: 12,
                height: 6,
                borderRadius: 3,
                background: "rgba(20,23,28,.12)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${pct}%`,
                  background: loop.text,
                  borderRadius: 3,
                }}
              />
            </div>
            <div
              className="mt-2 flex justify-between font-[family-name:var(--font-ibm-plex-mono)]"
              style={{ fontSize: 10, color: loop.muted, letterSpacing: "0.04em" }}
            >
              <span>
                {liftsTotal > 0
                  ? `${liftsChecked} OF ${liftsTotal} LIFTS CHECKED`
                  : "SEARCHING GRAPH"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        className="font-[family-name:var(--font-ibm-plex-mono)]"
        style={{
          fontSize: 9.5,
          color: loop.label,
          letterSpacing: "0.08em",
          marginTop: 20,
          marginBottom: 12,
        }}
      >
        BUILDING TIMELINE
      </div>
      <SkeletonLegs />

      <div className="mt-auto" style={{ padding: "14px 0 12px" }}>
        <button
          type="button"
          onClick={onCancel}
          className="w-full cursor-pointer"
          style={{
            minHeight: 54,
            borderRadius: 15,
            background: loop.raised,
            border: "1px solid rgba(0,0,0,.13)",
            fontSize: 16.5,
            fontWeight: 600,
            color: loop.text,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function SkeletonLegs() {
  const widths = ["72%", "58%", "78%", "52%", "64%"];
  return (
    <div className="flex flex-col gap-5">
      {widths.map((w, i) => (
        <div key={i} className="flex" style={{ gap: 14, opacity: 1 - i * 0.12 }}>
          <div className="flex flex-col items-center" style={{ width: 18 }}>
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: 99,
                border: `4px solid rgba(20,23,28,${0.14 - i * 0.012})`,
                boxSizing: "border-box",
              }}
            />
            {i < widths.length - 1 && (
              <span
                className="flex-1"
                style={{
                  width: 5,
                  minHeight: 28,
                  margin: "5px 0",
                  borderRadius: 3,
                  background: `rgba(20,23,28,${0.09 - i * 0.005})`,
                }}
              />
            )}
          </div>
          <div className="flex-1" style={{ paddingBottom: 8 }}>
            <div
              style={{
                height: 13,
                width: w,
                borderRadius: 5,
                background: "rgba(20,23,28,.12)",
              }}
            />
            <div
              style={{
                marginTop: 8,
                height: 11,
                width: "44%",
                borderRadius: 5,
                background: "rgba(20,23,28,.08)",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
