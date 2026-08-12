export function NetworkMissing({ wordmark = "Loop" }: { wordmark?: string }) {
  return (
    <main
      className="flex h-full items-center justify-center p-8"
      style={{ background: "#f7f8f9", color: "#14171c" }}
    >
      <div className="max-w-md text-center">
        <h1 className="text-[21px] font-bold tracking-[-0.02em]">{wordmark}</h1>
        <p className="mt-3 text-[13px] leading-relaxed" style={{ color: "#5c626c" }}>
          Network data is missing. Run{" "}
          <code
            className="rounded px-1.5 py-0.5 font-[family-name:var(--font-ibm-plex-mono)] text-[12px]"
            style={{ background: "#f0f2f5", color: "#2a2f37" }}
          >
            npm run refresh-network
          </code>{" "}
          to fetch the TfL line sequences and station topology into{" "}
          <code className="font-[family-name:var(--font-ibm-plex-mono)] text-[12px]">
            data/network.json
          </code>
          , then reload.
        </p>
      </div>
    </main>
  );
}
