import { useState } from 'react';
import { reportImage } from '@/boot';
import { getHost } from '@/services/host';
import { cn } from '@/utils/format';
import { Icon } from './Icon';

/**
 * An image loaded from the index's own thumbnail folder.
 *
 * Paths come from SQLite and are turned into asset URLs by the host, whose scope
 * is limited to that folder in `tauri.conf.json`. When there is nothing to show
 * the component renders the caller's fallback rather than a stand-in picture.
 */
export function AssetImage({
  path,
  alt = '',
  className,
  fallbackIcon = 'FileText',
  fallbackClassName,
}: {
  path: string | null | undefined;
  alt?: string;
  className?: string;
  fallbackIcon?: string;
  fallbackClassName?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!path || failed) {
    return (
      <span
        className={cn(
          'flex h-full w-full items-center justify-center bg-surface-2 text-ink-3',
          fallbackClassName,
        )}
      >
        <Icon name={fallbackIcon} size={15} strokeWidth={1.6} />
      </span>
    );
  }

  return (
    <img
      src={getHost().assetUrl(path)}
      alt={alt}
      draggable={false}
      loading="lazy"
      decoding="async"
      onLoad={() => reportImage(true, alt || 'asset image')}
      onError={() => {
        setFailed(true);
        reportImage(false, path);
      }}
      className={cn('h-full w-full object-cover', className)}
    />
  );
}
