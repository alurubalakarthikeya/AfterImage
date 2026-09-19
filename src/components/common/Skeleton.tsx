import { cn } from '@/utils/format';

/** Neutral placeholder used while the index answers a query. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-surface-3', className)}
      style={{ animationDuration: '1.6s' }}
    />
  );
}

export function SkeletonCard({ aspect = 4 / 3 }: { aspect?: number }) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <Skeleton className="w-full rounded-none" />
      <div className="w-full" style={{ aspectRatio: String(aspect) }}>
        <Skeleton className="h-full w-full rounded-none" />
      </div>
      <div className="space-y-2 p-3">
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-2.5 w-1/2" />
      </div>
    </div>
  );
}

export function SkeletonRows({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-btn" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-2.5 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
