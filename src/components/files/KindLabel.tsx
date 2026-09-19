import type { FileKind } from '@/types';
import { KIND_SINGULAR } from '@/stores/selectors';

/** One-word type name, used wherever metadata is too tight for a badge. */
export function KindLabel({ kind }: { kind: FileKind }) {
  return <span>{KIND_SINGULAR[kind]}</span>;
}
