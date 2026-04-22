import { SiteHeader } from "@/components/site-header";
import { StatsBar } from "@/components/stats-bar";
import { HomeView } from "./home-view";
import { getEvents } from "@/lib/events";

export const revalidate = 300;

export default async function Home() {
  const events = await getEvents({ limit: 2000 });
  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <StatsBar />
      <HomeView events={events} />
    </div>
  );
}
