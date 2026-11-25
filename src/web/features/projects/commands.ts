import { coreResult } from '@/core.ts'
import type { CoreResult } from '@/core.ts'
import type { BrowserCommandClient } from '@/server/browser-command.ts'

import { CreatedProjectSchema, ProjectMutationResultSchema } from './schemas.ts'

export const createProject = function createProject(
  { core, proof }: BrowserCommandClient,
  input: unknown,
): CoreResult<typeof CreatedProjectSchema.Type> {
  return coreResult(CreatedProjectSchema, core.webCreateProject(proof, input))
}
export const updateProject = function updateProject(
  { core, proof }: BrowserCommandClient,
  id: string,
  input: unknown,
): CoreResult<typeof ProjectMutationResultSchema.Type> {
  return coreResult(ProjectMutationResultSchema, core.webUpdateProject(proof, id, input))
}
