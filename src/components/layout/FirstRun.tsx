import { useState } from 'react';
import { useArchiveStore } from '@/stores/archive';
import { getHost } from '@/services/host';
import { cn } from '@/utils/format';
import { Icon } from '@/components/common/Icon';
import { Button } from '@/components/common/Button';
import { LogoMark } from '@/components/common/Logo';

const SUPPORTED: Array<{ label: string; detail: string; icon: string }> = [
  { label: 'Images', detail: 'JPG · PNG · WEBP · GIF · HEIC', icon: 'Image' },
  { label: 'Screenshots', detail: 'Captured text is read with OCR', icon: 'MonitorSmartphone' },
  { label: 'Documents', detail: 'PDF · TXT · MD', icon: 'FileText' },
  { label: 'Video', detail: 'MP4 · MOV · WEBM', icon: 'Film' },
];

/**
 * First run.
 *
 * AfterImage starts empty on purpose: it has no archive of its own to show, and
 * it will not invent one. Until the user grants a folder there is genuinely
 * nothing to render, so this screen asks for exactly that permission and
 * explains what happens next. It is the only place in the application that asks
 * the user to do anything before they get value.
 */
export function FirstRun() {
  const addFolder = useArchiveStore((state) => state.addFolder);
  const addFolderPath = useArchiveStore((state) => state.addFolderPath);
  const index = useArchiveStore((state) => state.index);
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState('');

  const host = getHost();
  const canPick = host.capabilities.nativeDialogs;

  const choose = async () => {
    setBusy(true);
    try {
      await addFolder();
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

  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-full max-w-[620px]">
        <div className="flex items-center gap-2.5">
          <LogoMark size={26} />
          <span className="text-card font-semibold tracking-[-0.01em] text-ink">AfterImage</span>
        </div>

        <h1 className="mt-5 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Choose folders to build your archive
        </h1>
        <p className="mt-2 max-w-[520px] text-body leading-relaxed text-ink-2">
          AfterImage only reads folders you explicitly select. Your files remain on this device —
          nothing is uploaded, copied or renamed. Pick the places where you keep screenshots,
          photos, notes and downloads, and the index builds itself in the background.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-2.5">
          {canPick ? (
            <Button
              variant="primary"
              icon="FolderOpen"
              loading={busy}
              onClick={() => void choose()}
            >
              Choose Folder
            </Button>
          ) : null}

          <form
            className="flex min-w-[260px] flex-1 items-center gap-2"
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
              className="h-10 min-w-0 flex-1 rounded-input border border-line-strong bg-surface px-3 font-mono text-meta text-ink outline-none transition-colors duration-150 placeholder:text-ink-3 focus:border-accent/50"
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

        {index.problem && (
          <p className="mt-3 flex items-start gap-2 rounded-panel border border-caution/30 bg-caution/10 px-3 py-2 text-2xs leading-relaxed text-ink-2">
            <Icon name="Info" size={12} className="mt-0.5 shrink-0" />
            {index.problem}
          </p>
        )}

        <div className="mt-7 grid grid-cols-2 gap-2.5">
          {SUPPORTED.map((item) => (
            <div
              key={item.label}
              className={cn(
                'flex items-start gap-2.5 rounded-thumb border border-line bg-surface p-3',
              )}
              style={{ boxShadow: 'var(--af-shadow-soft)' }}
            >
              <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent-softer text-accent-ink">
                <Icon name={item.icon} size={13} strokeWidth={1.9} />
              </span>
              <span className="min-w-0">
                <span className="block text-body font-medium text-ink">{item.label}</span>
                <span className="block text-2xs text-ink-3">{item.detail}</span>
              </span>
            </div>
          ))}
        </div>

        <p className="mt-6 flex items-center gap-2 text-2xs text-ink-3">
          <Icon name="Shield" size={12} strokeWidth={2} />
          Reading happens locally. Indexing, thumbnails and text extraction never leave this
          machine.
        </p>
      </div>
    </div>
  );
}
