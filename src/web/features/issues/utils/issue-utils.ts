export const PRIORITY_OPTIONS = (['urgent', 'high', 'medium', 'low', 'none'] as const).map((priority) => ({
  label: priority,
  value: priority,
}))
