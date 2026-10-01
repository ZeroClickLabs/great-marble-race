import HostGame from "@/components/host/HostGame";

export const metadata = { title: "Host · The Great Marble Race" };

export default async function HostPage({ params }: PageProps<"/host/[code]">) {
  const { code } = await params;
  return <HostGame code={code.toUpperCase()} />;
}
