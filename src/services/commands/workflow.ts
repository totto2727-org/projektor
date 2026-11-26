import { flattenError } from 'zod'

import { GetWorkflowSchema } from '#contracts/inputs/workflow.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'

import { ValidationError } from './errors.ts'
import { WORKFLOW_SPEC } from './workflow-content.ts'

/*
 * PROJ-933: agents re-fetch the ~1k token workflow spec every session even though it
 * rarely changes. `version` is a stable content hash of everything get_workflow returns (title,
 * description and body); a caller that
 * already holds it can pass it back as `ifVersion` and get `{ unchanged: true, version }`
 * instead of the full spec.
 */

const HEX_RADIX = 16
const HEX_DIGITS_PER_BYTE = 2
const VERSION_HASH_START = 0
const VERSION_HASH_LENGTH = 12

/**
 * Calculate the stable short version of a workflow payload.
 * @param {string} content The serialized workflow payload.
 * @returns {Promise<string>} The leading hexadecimal digits of its SHA-256 digest.
 */
export const hashWorkflowContent = async function hashWorkflowContent(content: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  const hex = [...new Uint8Array(buf)]
    .map((byte) => byte.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_BYTE, '0'))
    .join('')
  return hex.slice(VERSION_HASH_START, VERSION_HASH_LENGTH)
}

/*
 * The full returned payload, built once: the spec is a compile-time constant. The version
 * hashes exactly this object, so a change to the title or description bumps it too.
 */
const WORKFLOW_PAYLOAD = fieldsInOrder([
  ['title', WORKFLOW_SPEC.title],
  ['description', WORKFLOW_SPEC.description],
  ['content', WORKFLOW_SPEC.body.trim()],
])

type WorkflowResult =
  | { unchanged: boolean; version: string; title?: never; description?: never; content?: never }
  | (typeof WORKFLOW_PAYLOAD & { version: string; unchanged?: never })

interface WorkflowVersionCache {
  version?: Promise<string>
}

// Hashed lazily once per isolate. Not exported directly — callers (including routes/mcp.ts's
// `initialize` instructions) go through getWorkflow() below, the one service entry point.
// A rejected hash is not cached, so a transient failure doesn't stick for the isolate.
const cache: WorkflowVersionCache = {}

const computeWorkflowVersion = async function computeWorkflowVersion(): Promise<string> {
  try {
    return await hashWorkflowContent(JSON.stringify(WORKFLOW_PAYLOAD))
  } catch (error) {
    delete cache.version
    throw error
  }
}

export const getWorkflow = async function getWorkflow(raw: unknown = {}): Promise<WorkflowResult> {
  const result = GetWorkflowSchema.safeParse(raw)
  if (!result.success) {
    throw new ValidationError(flattenError(result.error))
  }
  const { ifVersion } = result.data

  cache.version ??= computeWorkflowVersion()
  const version = await cache.version
  if (ifVersion === version) {
    return { unchanged: true, version }
  }

  return { ...WORKFLOW_PAYLOAD, version }
}
