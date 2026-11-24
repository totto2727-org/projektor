import { coreResult } from '@/core.ts'
import type { BrowserCommandClient } from '@/server/browser-command.ts'

import { CreatedProjectSchema, ProjectMutationResultSchema } from './schemas.ts'

export const createProject = function createProject({ core, proof }: BrowserCommandClient, input: unknown) {
  return coreResult(CreatedProjectSchema, core.webCreateProject(proof, input))
}
export const updateProject = function updateProject({ core, proof }: BrowserCommandClient, id: string, input: unknown) {
  return coreResult(ProjectMutationResultSchema, core.webUpdateProject(proof, id, input))
}
