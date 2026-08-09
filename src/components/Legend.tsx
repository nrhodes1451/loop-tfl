export function Legend() {
  return (
    <div
      className="absolute bottom-[22px] left-6 z-10 flex max-w-[340px] flex-col gap-3 rounded-[10px] border px-4 py-3.5"
      style={{
        background: "rgba(255,255,255,0.92)",
        borderColor: "#d8dce2",
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: "#6f7681" }}
      >
        Lift status
      </div>
      <div className="flex gap-4">
        <Swatch color="#35c77b" label="Operational" />
        <Swatch color="#f2565c" label="Disrupted" />
        <Swatch color="#5f6672" label="No live data" />
      </div>
      <div className="h-px" style={{ background: "#e4e7ec" }} />
      <div className="flex flex-wrap gap-4">
        <div className="flex items-center gap-[7px] text-xs" style={{ color: "#3d4450" }}>
          <span
            className="inline-block h-[13px] w-[13px] rounded-full border-2 border-dashed"
            style={{ borderColor: "#576070" }}
          />
          No lift infrastructure
        </div>
        <div className="flex items-center gap-[7px] text-xs" style={{ color: "#3d4450" }}>
          <span
            className="inline-block h-[9px] w-[9px] rounded-full border"
            style={{ background: "#ffffff", borderColor: "#454c57" }}
          />
          Platform
        </div>
        <div className="flex items-center gap-[7px] text-xs" style={{ color: "#3d4450" }}>
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "#8b929c" }}
          />
          Lift
        </div>
        <div className="flex items-center gap-[7px] text-xs" style={{ color: "#3d4450" }}>
          <span
            className="relative inline-flex h-[13px] w-[13px] items-center justify-center rounded-full"
            style={{ background: "#35c77b" }}
            aria-hidden
          >
            <svg width="7" height="8" viewBox="0 0 7 8" fill="none">
              <path
                d="M2.6 0h1.8v3.2h1.7L3.5 7.2 0.9 3.2h1.7V0z"
                fill="#ffffff"
              />
            </svg>
          </span>
          Street level
        </div>
      </div>
      <div
        className="max-w-[300px] text-[11.5px] leading-normal text-pretty"
        style={{ color: "#6f7681" }}
      >
        A direct green line from street to platform means level or ramp access. A
        platform with no line to street has no step-free route at all — the gap is
        the point.
      </div>
      <div className="h-px" style={{ background: "#e4e7ec" }} />
      <div
        className="max-w-[300px] font-[family-name:var(--font-ibm-plex-mono)] text-[11px] leading-relaxed"
        style={{ color: "#6f7681" }}
      >
        drag to pan · scroll to zoom
        <br />
        click a station to expand
      </div>
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-[7px] text-xs" style={{ color: "#3d4450" }}>
      <span
        className="inline-block h-[9px] w-[9px] rounded-full"
        style={{ background: color }}
      />
      {label}
    </div>
  );
}
