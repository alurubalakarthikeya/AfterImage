import { Page } from '@/components/common/Page';
import { HeroCard } from '@/components/dashboard/HeroCard';
import { QuickStats } from '@/components/dashboard/QuickStats';
import { RecentFiles } from '@/components/dashboard/RecentFiles';
import { SmartCollections } from '@/components/dashboard/SmartCollections';
import { ActivityTimeline } from '@/components/dashboard/ActivityTimeline';

/**
 * The dashboard.
 *
 * Nothing on this page holds state of its own: every card reads the index and
 * runs its own query, so a file indexed while the dashboard is open shows up
 * without a reload. Two rows that behave differently at different widths: hero
 * and stats side by side while there is room, stacked below that. Container
 * queries rather than viewport queries, because the workspace narrows when the
 * inspector opens.
 */
export function Home() {
  return (
    <Page container>
      {/* The spec's workspace grid: hero flexible, stats a fixed 300px rail. */}
      <div className="grid gap-4 @3xl:grid-cols-[minmax(0,1fr)_300px]">
        <HeroCard />
        <QuickStats />
      </div>

      <RecentFiles />

      <div className="grid gap-4 @3xl:grid-cols-[minmax(0,1fr)_320px]">
        <SmartCollections />
        <ActivityTimeline limit={7} />
      </div>
    </Page>
  );
}
