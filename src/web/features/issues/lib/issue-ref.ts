export const formatIssueRef = function formatIssueRef(projectKey: string | null | undefined, number: number): string {
  return projectKey ? `${projectKey}-${number}` : String(number)
}

export const normalizeIssueRef = function normalizeIssueRef(ref: string): string {
  return ref.trim().toUpperCase()
}

export const isValidIssueRef = function isValidIssueRef(ref: string): boolean {
  return /^[A-Z][A-Z0-9]*-\d+$/.test(ref)
}
