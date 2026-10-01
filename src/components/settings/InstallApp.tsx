import { isTauri } from '@/services/host';
import { usePwaStore } from '@/stores/pwa';
import { useUIStore } from '@/stores/ui';
import { Row, Section } from '@/components/common/Section';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';

/**
 * Installing AfterImage as an app.
 *
 * The browser build is a page that can be made into an application: its own
 * icon, its own window, no address bar, and an interface that opens without a
 * network. Which of those is on offer depends entirely on the platform, so this
 * section reports the one it is in and says what to do about it — a button
 * where Chromium has an install prompt to raise, the Share sheet steps where
 * iOS has none, and the browser's own menu where neither has happened yet.
 *
 * The desktop build is not offered this at all: it is already an application,
 * installed by its installer, and a section telling it otherwise would be the
 * interface lying about where it is running.
 */
export function InstallApp() {
  const mode = usePwaStore((state) => state.mode);
  const busy = usePwaStore((state) => state.busy);
  const install = usePwaStore((state) => state.install);
  const pushNotice = useUIStore((state) => state.pushNotice);

  if (isTauri()) return null;

  const run = async () => {
    const outcome = await install();
    if (outcome === 'accepted') {
      pushNotice({ level: 'success', message: 'Installing AfterImage — look for it with your other apps.' });
    } else if (outcome === 'unavailable') {
      pushNotice({
        level: 'warn',
        message: 'This browser did not offer an install prompt. Its own menu can still install it.',
      });
    }
    // Dismissed is not reported: the user answered the browser's question and
    // does not need the interface to repeat it back to them.
  };

  if (mode === 'installed') {
    return (
      <Section
        icon="Smartphone"
        title="Installed"
        description="AfterImage is running as an app on this device."
      >
        <Row
          label="Opened from outside the browser"
          hint="Its own window, its own icon, no address bar — it sits with your other applications."
        >
          <Badge tone="positive" icon="Check">
            Installed
          </Badge>
        </Row>
        <Row
          label="Opens without a network"
          hint="The interface is kept on the device. Your files were never anywhere else, and the index lives in this browser's storage."
        >
          <Badge tone="neutral">Offline ready</Badge>
        </Row>
      </Section>
    );
  }

  const steps =
    mode === 'manual'
      ? [
          'Tap the Share button in the browser’s toolbar.',
          'Choose “Add to Home Screen”.',
          'Tap Add — AfterImage appears with your other apps.',
        ]
      : [];

  return (
    <Section
      icon="Smartphone"
      title="Install as an app"
      description="Adds AfterImage to this device as an application rather than a page."
    >
      <Row
        label="What installing does"
        hint="Its own icon and window, no address bar, and an interface that keeps working offline. Nothing is uploaded and no file moves: it shares this browser's storage, so the folders you have already granted are still there."
      >
        {mode === 'prompt' ? (
          <Button variant="primary" size="sm" icon="Download" loading={busy} onClick={() => void run()}>
            Install
          </Button>
        ) : mode === 'manual' ? (
          <Badge tone="neutral" icon="Share">
            Add to Home Screen
          </Badge>
        ) : (
          <Badge tone="caution">Not offered yet</Badge>
        )}
      </Row>

      {mode === 'manual' && (
        <ol className="flex flex-col gap-1.5">
          {steps.map((step, index) => (
            <li key={step} className="flex items-start gap-2 text-meta leading-relaxed text-ink-2">
              <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-2xs font-semibold tabular-nums text-ink-2">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}

      {mode === 'browser' && (
        <p className="flex items-start gap-2 text-meta leading-relaxed text-ink-2">
          <Icon name="Info" size={13} strokeWidth={2} className="mt-0.5 shrink-0 text-ink-3" />
          <span>
            This browser decides for itself when a site may be installed, and has not offered it
            here yet. It usually appears in the address bar, or under “Install app” and “Add to
            Home screen” in the browser's own menu. A copy served over plain HTTP — an address
            other than localhost — can never be installed.
          </span>
        </p>
      )}

      {mode === 'prompt' && (
        <p className="flex items-start gap-2 text-meta leading-relaxed text-ink-2">
          <Icon name="Info" size={13} strokeWidth={2} className="mt-0.5 shrink-0 text-ink-3" />
          <span>
            The browser raised this offer, so it is asking your permission through the button above
            rather than over the interface.
          </span>
        </p>
      )}
    </Section>
  );
}
