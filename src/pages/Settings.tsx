import { useEffect, useState } from 'react';
import type { Appearance, BuildInfo, Density } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';
import { getHost, isTauri } from '@/services/host';
import { clearBrowserArchive } from '@/services/host';
import { cn, formatClock, formatCount, formatDayLabel, formatStorage } from '@/utils/format';
import { USE_CASES } from '@/utils/useCases';
import { Page } from '@/components/common/Page';
import { Row, Section } from '@/components/common/Section';
import { Organizer } from '@/components/settings/Organizer';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { usePeopleStore } from '@/stores/people';
import { Badge } from '@/components/common/Badge';
import { Avatar } from '@/components/common/Avatar';
import { ProgressBar } from '@/components/common/ProgressBar';

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-150',
        checked ? 'bg-ink' : 'bg-sunken',
      )}
    >
      {/*
        * The knob is `canvas` — the token that means "the opposite of ink" —
        * because the track is `ink` when the switch is on. A white knob reads
        * on three of the four combinations and disappears on the fourth: in a
        * dark theme, `ink` is near-white, so white-on-white is a switch that
        * looks broken exactly where it matters most. The hairline keeps it
        * legible in the dark theme's off state as well, where the track is as
        * dark as the canvas behind it.
        */}
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 rounded-full border border-line-strong bg-canvas shadow-soft transition-transform duration-150',
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  );
}

const APPEARANCES: Array<{ id: Appearance; label: string }> = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
];

const DENSITIES: Array<{ id: Density; label: string }> = [
  { id: 'comfortable', label: 'Comfortable' },
  { id: 'compact', label: 'Compact' },
];

const MODELS = ['llama3.2:3b', 'qwen2.5:3b', 'phi3.5:mini', 'ministral:8b'];

/**
 * Settings.
 *
 * Every switch here maps to real behaviour, and the ones that need the desktop
 * build say so instead of pretending. Nothing on this page leaves the machine.
 */
export function Settings() {
  const settings = useSettingsStore();
  const folders = useArchiveStore((state) => state.folders);
  const storage = useArchiveStore((state) => state.storage);
  const activity = useArchiveStore((state) => state.activity);
  const pushNotice = useUIStore((state) => state.pushNotice);
  const [newFolder, setNewFolder] = useState('');
  const [build, setBuild] = useState<BuildInfo | null>(null);
  const [starting, setStarting] = useState(false);

  const host = getHost();
  const index = useArchiveStore((state) => state.index);
  const addFolder = useArchiveStore((state) => state.addFolder);
  const addFolderPath = useArchiveStore((state) => state.addFolderPath);
  const removeFolder = useArchiveStore((state) => state.removeFolder);
  const rescanFolder = useArchiveStore((state) => state.rescanFolder);
  const breakdown = Object.entries(storage.byKind).sort((a, b) => b[1] - a[1]);

  const people = usePeopleStore();
  const peopleModels = people.models ?? {
    bundles: [],
    available: false,
    missingMegabytes: 0,
    reason: 'Reading the model store…',
    canStart: false,
    onBattery: false,
  };
  const faceBundle = peopleModels.bundles.find((bundle) => bundle.name === 'faces');
  const facesReady = faceBundle?.ready ?? false;
  const facesCost = faceBundle ? Math.round(faceBundle.megabytes) : null;
  const peopleStats = people.stats;

  useEffect(() => {
    void people.loadModels();
    // The group counts belong in this page even when People has never been open.
    if (people.status === 'idle') void people.load();
    // Which build this is, read from the running binary. Never guessed from the
    // source tree, so it cannot claim to be newer than it is.
    void host
      .buildInfo()
      .then(setBuild)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Start the local indexer because the interface says it is not running.
   *
   * The model store cannot be read — let alone added to — without one, and the
   * one place it is started is at launch, where a slow machine can lose the
   * race. So this exists to turn "not running" into "running" without asking
   * anybody to open a terminal.
   */
  const startIndexer = async () => {
    setStarting(true);
    try {
      pushNotice({ level: 'success', message: await host.startService() });
      await people.loadModels();
    } catch (error) {
      pushNotice({
        level: 'error',
        message:
          error instanceof Error ? error.message : 'The local indexer could not be started.',
      });
    } finally {
      setStarting(false);
    }
  };

  return (
    // Centred rather than pinned left: with the inspector out of the way this
    // page owns the full width, and a fixed measure that hugs the left edge
    // would leave one unexplained void on the right.
    <Page className="mx-auto w-full max-w-[940px]">
      <PageHeader
        title="Settings"
        subtitle="Preferences for this machine. Nothing here syncs anywhere."
      >
        <Badge tone="accent" icon={isTauri() ? 'Shield' : 'Info'}>
          {host.name === 'tauri'
            ? 'Desktop build'
            : host.name === 'web'
              ? 'Web build · stored in this browser'
              : 'Browser preview'}
        </Badge>
      </PageHeader>

      <Section
        icon="User"
        title="Your profile"
        description="The name is taken from this machine when you first open AfterImage. Change it here and it is only ever stored on disk."
      >
        <Row label="Display name" hint="Used for the greeting on Home.">
          <div className="flex items-center gap-2.5">
            <Avatar name={settings.userName} size={30} />
            <input
              type="text"
              value={settings.userName}
              onChange={(event) => settings.setUserName(event.target.value)}
              placeholder="Your name"
              spellCheck={false}
              className="h-9 w-[200px] min-w-0 rounded-input border border-line-strong bg-surface px-3 text-meta text-ink outline-none transition-colors duration-150 placeholder:text-ink-3 focus:border-line-strong"
            />
          </div>
        </Row>

        <Row
          label="What you keep here"
          hint="Your own description of the archive. It changes nothing about indexing."
        >
          <div className="flex max-w-[340px] flex-wrap justify-end gap-1.5">
            {USE_CASES.map((item) => {
              const selected = settings.useCases.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    settings.setUseCases(
                      selected
                        ? settings.useCases.filter((value) => value !== item.id)
                        : [...settings.useCases, item.id],
                    )
                  }
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-pill border px-2.5 text-2xs font-medium transition-colors duration-150',
                    selected
                      ? 'border-line-strong bg-surface-3 text-ink'
                      : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
                  )}
                >
                  <Icon name={item.icon} size={12} strokeWidth={1.9} />
                  {item.label}
                </button>
              );
            })}
          </div>
        </Row>

        <Row label="Setup" hint="Reopens the first-run wizard: profile, folders, summary.">
          <Button
            variant="secondary"
            size="sm"
            icon="RefreshCw"
            onClick={() => settings.restartOnboarding()}
          >
            Run setup again
          </Button>
        </Row>
      </Section>

      <Section
        icon="Sun"
        title="Appearance"
        description="Theme, density and how much room thumbnails get."
      >
        <Row label="Theme">
          <div className="flex rounded-input border border-line bg-surface-2 p-0.5">
            {APPEARANCES.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => settings.setAppearance(option.id)}
                className={cn(
                  'rounded-[9px] px-3 py-1.5 text-meta transition-colors duration-150',
                  settings.appearance === option.id
                    ? 'bg-surface text-ink shadow-soft'
                    : 'text-ink-3 hover:text-ink-2',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Row>

        <Row label="Density" hint="Compact fits roughly a third more files per screen.">
          <div className="flex rounded-input border border-line bg-surface-2 p-0.5">
            {DENSITIES.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => settings.setDensity(option.id)}
                className={cn(
                  'rounded-[9px] px-3 py-1.5 text-meta transition-colors duration-150',
                  settings.density === option.id
                    ? 'bg-surface text-ink shadow-soft'
                    : 'text-ink-3 hover:text-ink-2',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Row>

        <Row label="Thumbnail size" hint={`${settings.thumbnailSize}px minimum column width`}>
          <input
            type="range"
            min={150}
            max={360}
            step={10}
            value={settings.thumbnailSize}
            onChange={(event) => settings.setThumbnailSize(Number(event.target.value))}
            className="w-[180px] accent-[var(--af-accent)]"
            aria-label="Thumbnail size"
          />
        </Row>

        <Row label="Show file metadata on cards">
          <Toggle
            label="Show file metadata on cards"
            checked={settings.showThumbnailMeta}
            onChange={settings.setShowThumbnailMeta}
          />
        </Row>

        <Row label="Reduce transparency" hint="Flattens the floating chrome over imagery.">
          <Toggle
            label="Reduce transparency"
            checked={settings.reduceTransparency}
            onChange={settings.setReduceTransparency}
          />
        </Row>
      </Section>

      <Section
        icon="Folder"
        title="Watched folders"
        description="AfterImage indexes what you point it at, and nothing else."
      >
        <div className="flex flex-col gap-1.5">
          {folders.map((folder) => (
            <div
              key={folder.id}
              className="flex items-center gap-3 rounded-thumb bg-surface-2 px-3 py-2"
            >
              <Icon
                name={folder.status === 'ok' ? 'Folder' : 'AlertTriangle'}
                size={14}
                strokeWidth={1.9}
                className={cn('shrink-0', folder.status === 'ok' ? 'text-ink-3' : 'text-caution')}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[11.5px] text-ink-2" title={folder.path}>
                  {folder.path}
                </span>
                <span className="block text-[10px] text-ink-3">
                  {formatCount(folder.fileCount)} files · {formatStorage(folder.sizeBytes)}
                  {folder.status === 'scanning' ? ' · scanning' : ''}
                  {folder.problem ? ` · ${folder.problem}` : ''}
                </span>
              </span>
              {folder.watched ? (
                <Badge tone="neutral">indexed</Badge>
              ) : (
                <Badge tone="caution">paused</Badge>
              )}
              <button
                type="button"
                onClick={() => void rescanFolder(folder.id)}
                className="shrink-0 text-ink-3 transition-colors hover:text-ink"
                aria-label={`Rescan ${folder.path}`}
              >
                <Icon name="RefreshCw" size={13} strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => void removeFolder(folder.id)}
                className="shrink-0 text-ink-3 transition-colors hover:text-critical"
                aria-label={`Stop watching ${folder.path}`}
              >
                <Icon name="X" size={13} strokeWidth={2.2} />
              </button>
            </div>
          ))}
          {folders.length === 0 && (
            <p className="text-meta text-ink-3">
              No folders yet. Add one to start building the index.
            </p>
          )}
        </div>

        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = newFolder.trim();
            if (!value) return;
            void addFolderPath(value);
            setNewFolder('');
          }}
        >
          <input
            value={newFolder}
            onChange={(event) => setNewFolder(event.target.value)}
            placeholder="~/Pictures/Screenshots"
            aria-label="Folder path"
            spellCheck={false}
            className="h-9 min-w-0 flex-[1_1_180px] rounded-input border border-line-strong bg-surface px-3 font-mono text-meta text-ink outline-none transition-colors focus:border-line-strong"
          />
          <Button type="submit" variant="secondary" size="sm" icon="Plus" disabled={!newFolder.trim()}>
            Add
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon="FolderOpen"
            disabled={!host.capabilities.nativeDialogs}
            onClick={() => void addFolder()}
          >
            Browse
          </Button>
        </form>
        {!host.capabilities.nativeDialogs && (
          <p className="text-2xs leading-relaxed text-ink-3">
            The folder picker is part of the desktop build. This preview can only describe what the
            index would do — it cannot read this machine's filesystem.
          </p>
        )}
      </Section>

      <Organizer />

      <Section
        icon="Cpu"
        title="Indexing and search"
        description="The pipeline runs locally. Turning the model off leaves search fully working."
      >
        <Row
          label="Local processing"
          hint="OCR, visual labels, embeddings and faces. Off leaves search on filenames, paths, tags and any text already in the index."
        >
          <Toggle
            label="Local processing"
            checked={settings.localProcessing}
            onChange={settings.setLocalProcessing}
          />
        </Row>
        <Row
          label="Index new files automatically"
          hint="Watches your folders, so a change on disk is read without being asked for."
        >
          <Toggle
            label="Auto index"
            checked={settings.autoIndex}
            onChange={settings.setAutoIndex}
          />
        </Row>
        <Row
          label="Keep indexing on battery"
          hint={
            peopleModels.onBattery
              ? 'This machine is on battery power now, so the queue is waiting for mains power.'
              : 'Off means the queue waits on battery power. Plugging in resumes it — nothing is lost.'
          }
        >
          <Toggle
            label="Index on battery"
            checked={settings.indexOnBattery}
            onChange={settings.setIndexOnBattery}
          />
        </Row>
        <Row
          label="Semantic search"
          hint="Adds vector similarity on top of full-text search using a local embedding model."
        >
          <Toggle
            label="Semantic search"
            checked={settings.semanticSearch}
            onChange={settings.setSemanticSearch}
          />
        </Row>
        <Row
          label="Local model"
          hint={settings.llmEnabled ? 'Used only to translate a question into structured filters. It never reads your files. Needs a model runtime listening on this machine.' : 'Off: search parses questions with the built-in rules, which need no model at all.'}
        >
          <div className="flex items-center gap-2">
            <select
              value={settings.llmModel}
              onChange={(event) => settings.setLlmModel(event.target.value)}
              disabled={!settings.llmEnabled}
              className="h-9 rounded-input border border-line bg-surface px-2.5 text-meta text-ink outline-none disabled:opacity-50"
            >
              {MODELS.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
            <Toggle
              label="Enable local model"
              checked={settings.llmEnabled}
              onChange={settings.setLlmEnabled}
            />
          </div>
        </Row>
        <Row label="Indexer service port" hint="The local FastAPI service listens on loopback only.">
          <input
            type="number"
            value={settings.servicePort}
            onChange={(event) => settings.setServicePort(Number(event.target.value))}
            className="h-9 w-[92px] rounded-input border border-line bg-surface px-2.5 text-meta tabular-nums text-ink outline-none"
          />
        </Row>
      </Section>

      <Section
        icon="ScanFace"
        title="People and face grouping"
        description="Faces are found and grouped on this machine, from your own photographs. The app never names anybody — it groups, and you decide who they are."
      >
        <Row
          label="Face models"
          hint={
            peopleModels.available
              ? `Where they live: ${peopleModels.directory ?? 'your app data folder'}`
              : (peopleModels.reason ?? 'Not available yet.')
          }
        >
          {/* Three different states, three different answers. Offering a
              download while nothing is running to download into is what made
              this button look broken; offering to start something that is not
              installed is the same mistake the other way round. */}
          {facesReady ? (
            <Badge tone="positive">Installed</Badge>
          ) : peopleModels.available ? (
            <Button
              variant="secondary"
              size="sm"
              icon="Download"
              disabled={people.busy}
              onClick={() => void people.installModels()}
            >
              Download{facesCost ? ` \u00b7 ${facesCost} MB` : ''}
            </Button>
          ) : peopleModels.canStart ? (
            <Button
              variant="secondary"
              size="sm"
              icon="Play"
              disabled={starting}
              onClick={() => void startIndexer()}
            >
              {starting ? 'Starting\u2026' : 'Start indexer'}
            </Button>
          ) : (
            <Badge tone="caution">Not installed</Badge>
          )}
        </Row>
        <Row
          label="Look for faces in what is already indexed"
          hint="Only files that have not been looked at are read, so running this twice costs nothing."
        >
          <Button
            variant="secondary"
            size="sm"
            icon="ScanFace"
            disabled={!facesReady || people.busy}
            onClick={() => void people.scan()}
          >
            Run
          </Button>
        </Row>
        <Row
          label="Groups"
          hint={`${peopleStats.people} people \u00b7 ${peopleStats.unnamed} still to name \u00b7 ${peopleStats.faces} faces in ${peopleStats.photos} photographs`}
        >
          <Button
            variant="ghost"
            size="sm"
            icon="RefreshCw"
            disabled={!facesReady || people.busy}
            onClick={() => void people.regroup()}
          >
            Regroup
          </Button>
        </Row>
      </Section>

      <Section icon="Bell" title="Notifications" description="Only for imports and finished indexing runs.">
        <Row label="Desktop notifications">
          <Toggle
            label="Desktop notifications"
            checked={settings.notifications}
            onChange={settings.setNotifications}
          />
        </Row>
      </Section>

      <Section icon="HardDrive" title="Storage" description="Where the index and thumbnails live.">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-[17px] font-semibold tabular-nums text-ink">
              {formatStorage(storage.usedBytes)}
            </span>
            <span className="text-2xs text-ink-3">
              {storage.totalBytes > 0
                ? `of ${formatStorage(storage.totalBytes)}`
                : `${formatCount(storage.indexedFiles)} files indexed`}
            </span>
          </div>
          <ProgressBar
            value={storage.usedBytes}
            max={storage.totalBytes > 0 ? storage.totalBytes : Math.max(1, storage.usedBytes)}
            className="mt-2"
            height={5}
          />
        </div>

        <div className="flex flex-col gap-2">
          {breakdown.map(([kind, bytes]) => (
            <div key={kind} className="flex items-center gap-3">
              <span className="w-[76px] shrink-0 text-2xs capitalize text-ink-2">{kind}</span>
              <ProgressBar
                value={bytes}
                max={storage.usedBytes}
                height={4}
                className="flex-1"
                tone="ink"
              />
              <span className="w-[62px] shrink-0 text-right text-2xs tabular-nums text-ink-3">
                {formatStorage(bytes)}
              </span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon="RefreshCw"
            disabled={folders.length === 0}
            onClick={() => folders.forEach((folder) => void rescanFolder(folder.id))}
          >
            Rescan all folders
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon="Pause"
            disabled={index.state !== 'indexing' && index.state !== 'scanning'}
            onClick={() => void useArchiveStore.getState().pauseIndexing()}
          >
            Pause indexing
          </Button>
          {!isTauri() && (
            <Button
              variant="ghost"
              size="sm"
              icon="Trash2"
              onClick={() => {
                void clearBrowserArchive();
                pushNotice({ level: 'success', message: 'Local state cleared — reloading.' });
                setTimeout(() => window.location.reload(), 500);
              }}
            >
              Clear local state
            </Button>
          )}
        </div>
        <p className="text-2xs text-ink-3">
          Rescanning skips files whose size and modification time are unchanged, so re-reading a
          large folder costs one directory walk.
        </p>
      </Section>

      <Section icon="Shield" title="Privacy" description="What leaves this machine: nothing.">
        <div className="flex flex-col gap-2 text-meta leading-relaxed text-ink-2">
          <p className="flex items-start gap-2">
            <Icon name="Check" size={13} className="mt-0.5 shrink-0 text-positive" />
            Index, thumbnails, embeddings and OCR all run locally. Search works fully offline.
          </p>
          <p className="flex items-start gap-2">
            <Icon name="Check" size={13} className="mt-0.5 shrink-0 text-positive" />
            The local model is optional and, when enabled, only rewrites queries into filters.
          </p>
          <p className="flex items-start gap-2">
            <Icon name="Check" size={13} className="mt-0.5 shrink-0 text-positive" />
            Nothing is uploaded, and there is no account service to upload it to.
          </p>
        </div>

        {/* Which build this is, read from the running binary rather than typed
            here. Two installers of AfterImage are indistinguishable in the
            window, so this row is the only honest answer to "did my new build
            install?" — and the paths below answer "where does it all live?". */}
        <div className="flex flex-wrap items-center gap-4 border-t border-line pt-3 text-2xs text-ink-3">
          <span>AfterImage {build?.version ?? __BUILD_VERSION__}</span>
          {build?.builtAt && (
            <span title={build.builtAt}>
              Built {formatDayLabel(build.builtAt)} at {formatClock(build.builtAt)}
            </span>
          )}
          <span>Host: {host.name}</span>
          <span>
            Index size:{' '}
            {formatCount(storage.indexedFiles)} files · {formatStorage(storage.usedBytes)}
          </span>
          <span>{formatCount(activity.length)} recent events</span>
        </div>

        {build && (
          <div className="flex flex-col gap-1 text-2xs text-ink-3">
            <span className="flex items-start gap-2">
              <Icon
                name={build.bundledIndexer ? 'Check' : 'Info'}
                size={12}
                className={cn('mt-0.5 shrink-0', build.bundledIndexer ? 'text-positive' : 'text-ink-3')}
              />
              {build.bundledIndexer
                ? 'Indexer: bundled with this build, so this machine needs no Python for OCR, labels or faces.'
                : 'Indexer: not bundled with this build, so it is started from a Python environment on this machine when one is present.'}
            </span>
            <span className="font-mono text-[10.5px] leading-relaxed">{build.dataDir}</span>
            {build.executable && (
              <span className="font-mono text-[10.5px] leading-relaxed">{build.executable}</span>
            )}
          </div>
        )}
      </Section>
    </Page>
  );
}
