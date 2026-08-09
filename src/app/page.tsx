import { AppShell } from "@/components/AppShell";
import { loadNetwork } from "@/lib/network";

export const dynamic = "force-dynamic";

export default async function Home() {
  try {
    const network = await loadNetwork();
    return <AppShell network={network} />;
  } catch {
    return (
      <main
        className="flex h-full items-center justify-center p-8"
        style={{ background: "#0b0d10", color: "#e9ecf1" }}
      >
        <div className="max-w-md text-center">
          <h1 className="text-[21px] font-bold tracking-[-0.02em]">Stepfree</h1>
          <p className="mt-3 text-[13px] leading-relaxed" style={{ color: "#838a95" }}>
            Network data is missing. Run{" "}
            <code
              className="rounded px-1.5 py-0.5 font-[family-name:var(--font-ibm-plex-mono)] text-[12px]"
              style={{ background: "#16191f", color: "#cfd5de" }}
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
}
