import PlayGame from "@/components/play/PlayGame";

export const metadata = { title: "Place your bets · The Great Marble Race" };

export default async function PlayPage({ params }: PageProps<"/play/[code]">) {
  const { code } = await params;
  return <PlayGame code={code.toUpperCase()} />;
}
