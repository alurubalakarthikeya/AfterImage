import { useEffect, useState } from 'react';
import { cn } from '@/utils/format';
import { USE_CASES, useCaseLabel } from '@/utils/useCases';
import { useSettingsStore } from '@/stores/settings';
import { useArchiveStore } from '@/stores/archive';
import { useUIStore } from '@/stores/ui';
import { getHost } from '@/services/host';
import { Icon } from '@/components/common/Icon';
import { Button } from '@/components/common/Button';
import { Avatar } from '@/components/common/Avatar';
import { Logo } from '@/components/common/Logo';
import { TitleBar } from '@/components/layout/TitleBar';
import { ThemeControl } from '@/components/layout/ThemeControl';

/** The three questions the first run actually needs answered, in order. */
const STEPS = ['You', 'Folders', 'Ready'] as const;

function Progress({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
      {STEPS.map((label, index) => (
        <div key={label} className="flex items-center gap-2">
          <span
            className={cn(
              'flex h-5 items-center gap-1.5 rounded-pill px-2 text-2xs font-medium transition-colors duration-200',
              index === step
                ? 'bg-surface-3 text-ink'
                : index < step
                  ? 'text-accent-ink'
                  : 'text-ink-3',
            )}
          >
            {index < step ? (
              <Icon name="Check" size={11} strokeWidth={2.4} />
            ) : (
              <span className="tabular-nums">{index + 1}</span>
            )}
            {label}
          </span>
          {index < STEPS.length - 1 && (
            <Icon
              name="ChevronRight"
              size={12}
              className={index < step ? 'text-accent/50' : 'text-ink-3/50'}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * First run.
 *
 * Shown once, before the shell, and never again unless the user asks for it.
 * It asks for exactly two things — who is using this machine, and which folders
 * the archive may read — and then gets out of the way. Folders are the only one
 * of those that is genuinely required, so the wizard will let the user pass
 * without granting anything; the shell's own empty state then takes over.
 */
export function Onboarding() {
  const storedName = useSettingsStore((state) => state.userName);
  const setUserName = useSettingsStore((state) => state.setUserName);
  const storedUseCases = useSettingsStore((state) => state.useCases);
  const setUseCases = useSettingsStore((state) => state.setUseCases);
  const completeOnboarding = useSettingsStore((state) => state.completeOnboarding);
  const reopening = useSettingsStore((state) => state.onboardingRestart);
  const pushNotice = useUIStore((state) => state.pushNotice);

  const folders = useArchiveStore((state) => state.folders);
  const addFolderPath = useArchiveStore((state) => state.addFolderPath);
  const removeFolder = useArchiveStore((state) => state.removeFolder);

  const [step, setStep] = useState(0);
  const [name, setName] = useState(storedName);
  const [cases, setCases] = useState<string[]>(storedUseCases);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);

  const host = getHost();
  const canPick = host.capabilities.nativeDialogs;

  // The operating system's account name arrives a beat after the first paint
  // (see `useLocalIdentity`). Adopt it only while the field is still untouched.
  useEffect(() => {
    if (!name.trim() && storedName.trim()) setName(storedName);
  }, [storedName, name]);

  const toggleCase = (id: string) =>
    setCases((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );

  const walk = async () => {
    setBusy(true);
    try {
      const chosen = await host.chooseFolders();
      for (const value of chosen) {
        await addFolderPath(value);
      }
    } finally {
      setBusy(false);
    }
  };

  const submitPath = async () => {
    const value = path.trim();
    if (!value) return;
    setBusy(true);
    try {
      const folder = await addFolderPath(value);
      if (folder) setPath('');
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    setUserName(name.trim());
    setUseCases(cases);
    completeOnboarding();
    if (folders.length > 0) {
      pushNotice({
        level: 'success',
        message: `Indexing ${folders.length === 1 ? 'your folder' : `${folders.length} folders`} — the archive builds itself in the background.`,
      });
    }
  };

  const next = () => {
    if (step === 0) setUserName(name.trim());
    setStep((current) => Math.min(STEPS.length - 1, current + 1));
  };
  const back = () => setStep((current) => Math.max(0, current - 1));

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      {/* The wizard is the first thing the user ever sees, so it has to be a
          window like any other: same chrome, same controls, same theme switch. */}
      <TitleBar
        left={
          <div data-tauri-drag-region className="flex shrink-0 items-center pl-6 pr-4">
            <Logo compact size="sm" />
          </div>
        }
        right={
          <div className="pr-1.5">
            <ThemeControl />
          </div>
        }
      />

      <div className="af-route-enter flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-10">
        <div className="w-full max-w-[600px]">
          <div className="flex items-center justify-end gap-4">
            <Progress step={step} />
          </div>

          <div className="mt-6">
          {step === 0 && (
            <section>
              <h1 className="text-title font-semibold leading-tight tracking-[-0.02em] text-ink">
                Let&rsquo;s set this up for you
              </h1>
              <p className="mt-2 max-w-[520px] text-body leading-relaxed text-ink-2">
                AfterImage is a local archive. This takes a minute, and everything you tell it stays on
                this machine.
              </p>

              <div className="mt-6 flex items-center gap-3">
                <Avatar name={name} size={44} />
                <div className="min-w-0 flex-1">
                  <label htmlFor="af-onboarding-name" className="text-2xs font-medium text-ink-2">
                    What should the archive call you?
                  </label>
                  <input
                    id="af-onboarding-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Your name"
                    autoFocus
                    spellCheck={false}
                    className="mt-1 h-10 w-full rounded-input border border-line-strong bg-surface px-3 text-body text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-line-strong"
                  />
                </div>
              </div>

              <div className="mt-6">
                <p className="text-2xs font-medium text-ink-2">
                  What do you keep here? <span className="font-normal text-ink-3">Optional</span>
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {USE_CASES.map((item) => {
                    const selected = cases.includes(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleCase(item.id)}
                        className={cn(
                          'inline-flex h-8 items-center gap-1.5 rounded-pill border px-3 text-meta font-medium transition-colors duration-150',
                          selected
                            ? 'border-line-strong bg-surface-3 text-ink'
                            : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
                        )}
                      >
                        <Icon name={item.icon} size={13} strokeWidth={1.9} />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {step === 1 && (
            <section>
              <h1 className="text-title font-semibold leading-tight tracking-[-0.02em] text-ink">
                Which folders should be indexed?
              </h1>
              <p className="mt-2 max-w-[520px] text-body leading-relaxed text-ink-2">
                Pick the places where your screenshots, photos and documents live. AfterImage only
                reads what you choose here, and it never moves or renames anything.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-2.5">
                {canPick && (
                  <Button variant="primary" icon="FolderOpen" loading={busy} onClick={() => void walk()}>
                    Choose folders
                  </Button>
                )}
                <form
                  className="flex min-w-[240px] flex-1 items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitPath();
                  }}
                >
                  <input
                    value={path}
                    onChange={(event) => setPath(event.target.value)}
                    placeholder="…or paste an absolute path"
                    aria-label="Folder path"
                    spellCheck={false}
                    className="h-10 min-w-0 flex-1 rounded-input border border-line-strong bg-surface px-3 font-mono text-meta text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-line-strong"
                  />
                  <Button
                    type="submit"
                    variant="secondary"
                    icon="Plus"
                    disabled={!path.trim()}
                    loading={busy}
                  >
                    Add
                  </Button>
                </form>
              </div>

              {!canPick && (
                <p className="mt-3 text-2xs leading-relaxed text-ink-3">
                  The folder picker is part of the desktop build. This preview can describe the index
                  but cannot read this machine&rsquo;s filesystem.
                </p>
              )}

              <ul className="mt-5 flex flex-col gap-2">
                {folders.map((folder) => (
                  <li
                    key={folder.id}
                    className="flex items-center gap-3 rounded-panel border border-line bg-surface px-3 py-2.5"
                  >
                    <Icon name="Folder" size={16} strokeWidth={1.8} className="shrink-0 text-ink-3" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-body text-ink">{folder.name}</div>
                      <div className="truncate font-mono text-2xs text-ink-3">{folder.path}</div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Stop watching ${folder.name}`}
                      onClick={() => void removeFolder(folder.id)}
                      className="shrink-0 rounded-[8px] p-1.5 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink"
                    >
                      <Icon name="X" size={14} />
                    </button>
                  </li>
                ))}
                {folders.length === 0 && (
                  <li className="rounded-panel border border-dashed border-line px-3 py-6 text-center text-meta text-ink-3">
                    No folders yet — you can also do this later from the archive window.
                  </li>
                )}
              </ul>

              <p className="mt-4 flex items-center gap-2 text-2xs text-ink-3">
                <Icon name="Shield" size={12} strokeWidth={2} />
                Indexing, thumbnails and text extraction all happen on this machine.
              </p>
            </section>
          )}

          {step === 2 && (
            <section>
              <h1 className="text-title font-semibold leading-tight tracking-[-0.02em] text-ink">
                {name.trim() ? `Ready when you are, ${name.trim().split(/\s+/)[0]}` : 'Ready when you are'}
              </h1>
              <p className="mt-2 max-w-[520px] text-body leading-relaxed text-ink-2">
                {folders.length > 0
                  ? 'AfterImage will scan what you chose now and keep watching it. Anything new is indexed in the background.'
                  : 'You have not chosen a folder yet, so the archive will open empty and ask for one. That is fine — you can start with a single folder.'}
              </p>

              <dl className="mt-6 divide-y divide-line border-y border-line">
                <div className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="text-meta text-ink-2">Name</dt>
                  <dd className="truncate text-body text-ink">
                    {name.trim() || <span className="text-ink-3">Not set</span>}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="text-meta text-ink-2">Folders</dt>
                  <dd className="text-body tabular-nums text-ink">{folders.length}</dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="text-meta text-ink-2">What you keep here</dt>
                  <dd className="min-w-0 truncate text-body text-ink">
                    {cases.length > 0 ? (
                      cases.map(useCaseLabel).join(' · ')
                    ) : (
                      <span className="text-ink-3">Not set</span>
                    )}
                  </dd>
                </div>
              </dl>

              <p className="mt-4 text-2xs leading-relaxed text-ink-3">
                You can change all of this later in Settings, and rerun this setup at any time.
              </p>
            </section>
          )}
        </div>

          <div className="mt-8 flex items-center justify-between gap-3 border-t border-line pt-5">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                icon="ChevronLeft"
                onClick={back}
                className={cn(step === 0 && 'invisible')}
              >
                Back
              </Button>
              {reopening && (
                <Button variant="ghost" onClick={completeOnboarding}>
                  Close
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {step < STEPS.length - 1 ? (
                <>
                  {step === 1 && (
                    <Button variant="ghost" onClick={() => setStep(STEPS.length - 1)}>
                      Skip for now
                    </Button>
                  )}
                  <Button variant="primary" iconRight="ArrowRight" onClick={next}>
                    Continue
                  </Button>
                </>
              ) : (
                <Button variant="primary" icon="Check" onClick={finish}>
                  Open my archive
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
