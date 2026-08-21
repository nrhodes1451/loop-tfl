import { notFound } from "next/navigation";
import { SchematicPage } from "@/components/schematic/SchematicPage";
import {
  SchematicNotFoundError,
  listSchematicStations,
  loadSchematic,
} from "@/lib/schematic/load";
import type { SchematicStation } from "@/lib/schematic/types";

export async function generateStaticParams() {
  const stations = await listSchematicStations();
  return stations.map((s) => ({ stationId: s.id }));
}

export async function generateMetadata(
  props: PageProps<"/schematic/[stationId]">,
) {
  const { stationId: raw } = await props.params;
  const stationId = decodeURIComponent(raw);
  try {
    const station = await loadSchematic(stationId);
    return {
      title: `${station.name} schematic — not to scale`,
      description: station.disclaimer,
    };
  } catch {
    return { title: "Schematic station view — not to scale" };
  }
}

export default async function SchematicStationPage(
  props: PageProps<"/schematic/[stationId]">,
) {
  const { stationId: raw } = await props.params;
  const stationId = decodeURIComponent(raw);
  const stations = await listSchematicStations();
  let station: SchematicStation;
  try {
    station = await loadSchematic(stationId);
  } catch (err) {
    if (err instanceof SchematicNotFoundError) notFound();
    throw err;
  }
  return <SchematicPage station={station} stations={stations} />;
}
