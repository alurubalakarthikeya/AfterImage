import type { ArchiveFile, ImageDna as ImageDnaData } from '@/types';
import { useImageDna } from '@/hooks/useImageDna';
import { cn, formatBytes, formatResolution, titleCase } from '@/utils/format';
import { Skeleton } from '@/components/common/Skeleton';
import { ProgressBar } from '@/components/common/ProgressBar';

/**
 * Image DNA.
 *
 * What a picture is made of, in the space the inspector already has: the facts
 * the scan read from the file, the colours that cover it, three measured
 * properties, and the words for what those numbers mean.
 *
 * Two rules it inherits from the rest of the archive: every value is measured on
 * this machine from the user's own file, and a value that could not be measured
 * is left out. It never prints a placeholder, and it says why when it has
 * nothing — a picture whose format this build cannot decode still shows its
 * dimensions, its format and its dates, because those were never in doubt.
 */
export function ImageDna({ file }: { file: ArchiveFile }) {
  const { dna, loading, error } = useImageDna(file.id, file.modifiedAt);

  if (loading && !dna) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-9 w-full rounded-[7px]" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
      </div>
    );
  }

  if (error || !dna) {
    return (
      <p className="text-2xs leading-relaxed text-ink-3">
        {error ?? 'This picture could not be measured on this machine.'}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Facts dna={dna} />
      {dna.decoded ? <Measured dna={dna} /> : null}
      {!dna.decoded && dna.reason ? (
        <p className="text-2xs leading-relaxed text-ink-3">{dna.reason}</p>
      ) : null}
      {dna.decoded && dna.reason ? (
        <p className="text-[10px] leading-relaxed text-ink-3">{dna.reason}</p>
      ) : null}
    </div>
  );
}

/** The rows the scanner wrote: dimensions, ratio, format, size, dates. */
function Facts({ dna }: { dna: ImageDnaData }) {
  const resolution = formatResolution(dna.width, dna.height);
  const ratio = aspectLabel(dna);

  return (
    <div className="flex flex-col gap-1">
      {resolution && (
        <div className="font-mono text-[12px] tracking-[-0.01em] text-ink" data-selectable>
          {resolution}
          {ratio ? <span className="text-ink-3"> · {ratio}</span> : null}
        </div>
      )}
      <div className="font-mono text-[11px] text-ink-3" data-selectable>
        {dna.format} · {formatBytes(dna.bytes)}
      </div>
    </div>
  );
}

function Measured({ dna }: { dna: ImageDnaData }) {
  const words = characteristics(dna);
  const hasMetrics =
    dna.brightness !== undefined || dna.contrast !== undefined || dna.sharpness !== undefined;

  return (
    <>
      {dna.palette.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10.5px] uppercase tracking-[0.07em] text-ink-3">Colours</span>
          <div className="flex h-9 gap-1" role="list" aria-label="Dominant colours">
            {dna.palette.map((color) => {
              const share = `${Math.round(color.share * 100)}% of the picture`;
              return (
                <span
                  key={color.hex}
                  role="listitem"
                  // Width follows weight: the swatch row is a bar chart of what
                  // the picture is actually made of, not six equal chips.
                  style={{
                    flex: `${Math.max(color.share, 0.05)} 1 0%`,
                    backgroundColor: color.hex,
                  }}
                  className="h-full rounded-[7px] border border-line"
                  title={`${color.hex} · ${share}`}
                  aria-label={`${color.hex}, ${share}`}
                />
              );
            })}
          </div>
        </div>
      )}

      {hasMetrics && (
        <div className="flex flex-col gap-1.5">
          {dna.brightness !== undefined && <Metric label="Brightness" value={dna.brightness} />}
          {dna.contrast !== undefined && <Metric label="Contrast" value={dna.contrast} />}
          {dna.sharpness !== undefined && <Metric label="Detail" value={dna.sharpness} />}
        </div>
      )}

      {words.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {words.map((word) => (
            <span
              key={word}
              className="inline-flex items-center rounded-pill bg-surface-2 px-2.5 py-1 text-2xs text-ink-2"
            >
              {word}
            </span>
          ))}
        </div>
      )}

      {dna.palette.length > 0 && (
        <span className="font-mono text-[10px] text-ink-3" data-selectable>
          {dna.palette
            .slice(0, 3)
            .map((color) => color.hex)
            .join('  ')}
        </span>
      )}

      {dna.objects.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10.5px] uppercase tracking-[0.07em] text-ink-3">
            Detected
            <span className="ml-1.5 normal-case tracking-normal text-ink-3/80">local labels</span>
          </span>
          <div className="flex flex-wrap gap-1.5">
            {dna.objects.slice(0, 8).map((object) => (
              <span
                key={object}
                className={cn(
                  'inline-flex items-center rounded-pill bg-surface-2 px-2.5 py-1 text-2xs text-ink-2',
                )}
              >
                {object}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[62px] shrink-0 text-[10.5px] uppercase tracking-[0.07em] text-ink-3">
        {label}
      </span>
      <ProgressBar value={value} max={1} height={3} className="flex-1" />
      <span className="w-[26px] shrink-0 text-right font-mono text-[10px] tabular-nums text-ink-2">
        {Math.round(value * 100)}
      </span>
    </div>
  );
}

/**
 * The ratio in the form people write ratios in.
 *
 * 3840×2160 reduces to 16:9 and reads at a glance. 3000×1993 does not reduce to
 * anything anyone recognises, so it is reported as the decimal it is rather than
 * as 3000:1993.
 */
function aspectLabel(dna: ImageDnaData): string | null {
  const { width, height } = dna;
  if (!width || !height) return dna.aspect ? `${dna.aspect}:1` : null;

  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height) || 1;
  const ratioWidth = Math.round(width / divisor);
  const ratioHeight = Math.round(height / divisor);
  if (ratioWidth <= 40 && ratioHeight <= 40) return `${ratioWidth}:${ratioHeight}`;
  return `${(width / height).toFixed(2)}:1`;
}

/** The words behind the numbers, so the panel says something at a glance. */
function characteristics(dna: ImageDnaData): string[] {
  const words: string[] = [];
  if (dna.temperature) words.push(titleCase(dna.temperature));
  if (dna.brightness !== undefined) {
    words.push(dna.brightness < 0.35 ? 'Dark' : dna.brightness > 0.65 ? 'Bright' : 'Mid-toned');
  }
  if (dna.contrast !== undefined) {
    words.push(
      dna.contrast < 0.1 ? 'Low contrast' : dna.contrast > 0.2 ? 'High contrast' : 'Balanced',
    );
  }
  if (dna.saturation !== undefined) {
    words.push(dna.saturation < 0.12 ? 'Muted' : dna.saturation > 0.4 ? 'Vivid' : 'Natural colour');
  }
  if (dna.sharpness !== undefined) {
    words.push(
      dna.sharpness < 0.35 ? 'Soft focus' : dna.sharpness > 0.7 ? 'Crisp detail' : 'Moderate detail',
    );
  }
  if (dna.orientation) words.push(titleCase(dna.orientation));
  return words;
}
