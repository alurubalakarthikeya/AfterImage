import { useEffect, useState, type ReactNode } from 'react';
import { isTauri } from '@/services/host';
import { cn } from '@/utils/format';
import { Icon } from '@/components/common/Icon';

/**
 * The window's own chrome.
 *
 * The app ships frameless: a native title bar would sit above this one and
 * duplicate every control that is already here. What replaces it is the row
 * below — brand on the left, the working area in the middle, window buttons
 * flush to the right edge, exactly where the operating system would put them.
 *
 * Drag is handled by `data-tauri-drag-region`, which looks at the element under
 * the pointer. That is why the attribute is repeated on the flexible spacer
 * rather than declared once on the header: a click that lands on a bare child
 * of a draggable parent is not a drag.
 */

type WindowAction = 'minimize' | 'maximize' | 'unmaximize' | 'close';

async function control(action: WindowAction): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    if (action === 'maximize') await win.maximize();
    else if (action === 'unmaximize') await win.unmaximize();
    else if (action === 'minimize') await win.minimize();
    else await win.close();
  } catch {
    /* outside the desktop shell there is no window to control */
  }
}

function CaptionButton({
  label,
  onClick,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'inline-flex h-full w-[46px] items-center justify-center text-ink-2 transition-colors duration-100',
        danger
          ? 'hover:bg-[#c42b1c] hover:text-white active:bg-[#b3271a]'
          : 'hover:bg-surface-3 hover:text-ink active:bg-line-strong',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Minimize, maximize/restore, close.
 *
 * Renders nothing in the browser preview, where there is no window to control —
 * an inert set of buttons would be a lie about what the app can do.
 */
export function WindowControls() {
  const [native, setNative] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    setNative(true);

    let dispose: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        const sync = async () => setMaximized(await win.isMaximized());
        await sync();
        const off = await win.onResized(() => void sync());
        if (cancelled) off();
        else dispose = off;
      } catch {
        /* the window API is unavailable outside Tauri */
      }
    })();

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  if (!native) return null;

  return (
    <div className="flex shrink-0 items-stretch self-stretch pl-0.5">
      <CaptionButton label="Minimize" onClick={() => void control('minimize')}>
        <Icon name="Minus" size={15} strokeWidth={2} />
      </CaptionButton>
      <CaptionButton
        label={maximized ? 'Restore' : 'Maximize'}
        onClick={() => void control(maximized ? 'unmaximize' : 'maximize')}
      >
        {maximized ? <Icon name="Copy" size={13} strokeWidth={2} /> : <Icon name="Square" size={12.5} strokeWidth={2} />}
      </CaptionButton>
      <CaptionButton label="Close" danger onClick={() => void control('close')}>
        <Icon name="X" size={16} strokeWidth={2} />
      </CaptionButton>
    </div>
  );
}

/**
 * The row every screen sits under — the wizard included, which is why the
 * window can be moved and closed before the archive has loaded.
 */
export function TitleBar({
  left,
  center,
  right,
  className,
}: {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'glass relative z-40 flex h-12 shrink-0 items-stretch border-b border-line',
        className,
      )}
    >
      {left}

      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-3 px-3">
        {center}
      </div>

      {right && <div className="no-drag flex shrink-0 items-center gap-1">{right}</div>}

      <WindowControls />
    </header>
  );
}
