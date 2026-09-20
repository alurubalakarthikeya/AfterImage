import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { Icon } from '@/components/common/Icon';
import { IconButton, IconButtonGroup } from '@/components/common/IconButton';
import { Tooltip } from '@/components/common/Tooltip';
import { AppearanceMenu } from './AppearanceMenu';

/**
 * Appearance.
 *
 * Two controls rather than one, because they answer different questions. The
 * icon flips the theme in a single click — the thing people actually reach for
 * a hundred times — and the caret behind it opens the fuller panel for density,
 * thumbnail scale and the "follow the system" option.
 *
 * It lives on its own because the wizard needs it too: choosing a theme is part
 * of setting the machine up, not something to discover afterwards.
 */
export function ThemeControl() {
  const appearance = useSettingsStore((state) => state.appearance);
  const setAppearance = useSettingsStore((state) => state.setAppearance);
  const open = useUIStore((state) => state.appearanceOpen);
  const setOpen = useUIStore((state) => state.setAppearanceOpen);
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');

  const resolved = appearance === 'system' ? (prefersDark ? 'dark' : 'light') : appearance;
  const dark = resolved === 'dark';
  const label = dark ? 'Switch to light appearance' : 'Switch to dark appearance';

  return (
    <div className="relative flex items-center">
      <IconButtonGroup>
        <Tooltip label={label} side="bottom">
          <IconButton
            size="sm"
            label={label}
            onClick={() => setAppearance(dark ? 'light' : 'dark')}
          >
            <Icon name={dark ? 'Moon' : 'Sun'} size={15} strokeWidth={1.9} />
          </IconButton>
        </Tooltip>
        <Tooltip
          label={appearance === 'system' ? 'Appearance · following system' : 'Display settings'}
          side="bottom"
        >
          <IconButton size="sm" label="Display settings" active={open} onClick={() => setOpen(!open)}>
            <Icon name="ChevronDown" size={13} strokeWidth={2.4} />
          </IconButton>
        </Tooltip>
      </IconButtonGroup>
      <AppearanceMenu />
    </div>
  );
}
