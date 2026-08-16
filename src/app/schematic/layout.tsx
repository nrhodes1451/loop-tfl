import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Schematic station view — not to scale",
  description:
    "Illustrative schematic 3D station view. Not to scale, not for wayfinding, not used for routing.",
};

export default function SchematicLayout({
  children,
}: LayoutProps<"/schematic">) {
  return <div className="h-full overflow-hidden">{children}</div>;
}
