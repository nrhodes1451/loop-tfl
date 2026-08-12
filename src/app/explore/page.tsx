import { AppShell } from "@/components/AppShell";
import { NetworkMissing } from "@/components/NetworkMissing";
import { loadNetwork } from "@/lib/network";

export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  let network;
  try {
    network = await loadNetwork();
  } catch {
    return <NetworkMissing wordmark="Stepfree" />;
  }
  return <AppShell network={network} />;
}
