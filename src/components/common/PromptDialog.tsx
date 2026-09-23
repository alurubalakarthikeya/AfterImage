import { useEffect, useState } from 'react';
import { Modal } from './Overlay';
import { Button } from './Button';

/**
 * A single-field prompt.
 *
 * Renaming a file, renaming a collection and tagging all ask the same question —
 * one short string — so they ask it with the same dialog rather than three that
 * look almost the same. It lives in `common` for that reason: the styling is the
 * application's, and the callers only supply the words.
 */
export function PromptDialog({
  open,
  title,
  description,
  initialValue,
  placeholder,
  confirmLabel,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const [value, setValue] = useState(initialValue ?? '');

  useEffect(() => {
    if (open) setValue(initialValue ?? '');
  }, [open, initialValue]);

  return (
    <Modal open={open} onClose={onClose} className="max-w-[420px]">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!value.trim()) return;
          onConfirm(value.trim());
          onClose();
        }}
        className="p-5"
      >
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-1 text-meta text-ink-2">{description}</p>}
        <input
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          className="mt-4 h-10 w-full rounded-input border border-line-strong bg-surface px-3 text-body text-ink outline-none transition-colors focus:border-line-strong"
        />
        {children}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={!value.trim()}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
