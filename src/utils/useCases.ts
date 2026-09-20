/**
 * The buckets a person can say they keep in their archive.
 *
 * This is a label the user applies to themselves, not a classifier: nothing in
 * the pipeline reads it, and it never changes what gets indexed. It exists so
 * the archive can be described in the user's own terms rather than as "N files
 * in M folders". Shared between onboarding and Settings so the two lists can
 * never drift apart.
 */
export interface UseCase {
  id: string;
  label: string;
  icon: string;
}

export const USE_CASES: UseCase[] = [
  { id: 'photography', label: 'Photography', icon: 'Image' },
  { id: 'screenshots', label: 'Screenshots', icon: 'MonitorSmartphone' },
  { id: 'design', label: 'Design work', icon: 'Palette' },
  { id: 'documents', label: 'Documents', icon: 'FileText' },
  { id: 'development', label: 'Development', icon: 'Terminal' },
  { id: 'personal', label: 'Personal archive', icon: 'Archive' },
];

export function useCaseLabel(id: string): string {
  return USE_CASES.find((item) => item.id === id)?.label ?? id;
}
