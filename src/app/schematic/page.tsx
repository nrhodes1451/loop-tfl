import { SchematicPage } from "@/components/schematic/SchematicPage";
import { loadSchematic } from "@/lib/schematic/load";

export default async function SchematicRoute() {
  const station = await loadSchematic("HUBKGX");
  return <SchematicPage station={station} />;
}
