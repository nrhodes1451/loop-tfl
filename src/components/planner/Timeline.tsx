import type { Leg } from "@/lib/plan";
import { loop } from "@/lib/tokens";
import { LegRow } from "./LegRow";

export function Timeline({
  legs,
  label,
}: {
  legs: Leg[];
  label?: string;
}) {
  return (
    <div>
      {label && (
        <div
          className="font-[family-name:var(--font-ibm-plex-mono)]"
          style={{
            fontSize: 9.5,
            color: loop.label,
            letterSpacing: "0.08em",
            marginBottom: 12,
          }}
        >
          {label}
        </div>
      )}
      <ol className="m-0 p-0">
        {legs.map((leg, i) => (
          <LegRow key={`${leg.kind}-${leg.stationId ?? i}-${i}`} leg={leg} last={i === legs.length - 1} />
        ))}
      </ol>
    </div>
  );
}
