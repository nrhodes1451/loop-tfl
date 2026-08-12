import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Stepfree — London live lift status",
  description:
    "Unofficial accessibility tool visualising London public transport step-free status as a network graph. Not affiliated with TfL.",
};

export default function ExploreLayout({ children }: LayoutProps<"/explore">) {
  return <div className="h-full overflow-hidden">{children}</div>;
}
