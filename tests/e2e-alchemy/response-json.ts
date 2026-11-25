import type { APIResponse } from '@playwright/test'
import { Data, Schema } from 'effect'

import { ApiUserBootstrap } from '#contracts/api-auth.ts'
import { ApiResults } from '#contracts/api-results.ts'

const responseSchemas = {
  attachment: Schema.Struct({ id: Schema.String }),
  issue: ApiResults.apiCreateIssue,
  linkedAttachment: ApiResults.apiCreateLinkAttachment,
  metrics: ApiResults.apiGetFlowMetrics,
  project: ApiResults.apiCreateProject,
  session: ApiUserBootstrap,
}

class AcceptanceJsonShapeError extends Data.TaggedError('AcceptanceJsonShapeError')<Readonly<{ message: string }>> {}

/**
 * Validate the acceptance setup response and retain the original JSON.
 *
 * @template Key The response kind expected by the scenario.
 * @param {Pick<APIResponse, 'json' | 'status'>} response The Playwright API response.
 * @param {Key} kind The expected response kind.
 * @returns {Promise<(typeof responseSchemas)[Key]['Type']>} The validated response values.
 */
export const readAcceptanceJson = async function readAcceptanceJson<Key extends keyof typeof responseSchemas>(
  response: Pick<APIResponse, 'json' | 'status'>,
  kind: Key,
): Promise<(typeof responseSchemas)[Key]['Type']> {
  const body: unknown = await response.json()
  const isExpectedResponse = Schema.is(responseSchemas[kind])
  if (isExpectedResponse(body)) {
    return body
  }
  throw new AcceptanceJsonShapeError({
    message: `Acceptance API response has an unexpected ${kind} shape (HTTP ${String(response.status())}).`,
  })
}
