/*
 * PROJ-884 (and PROJ-896's "ban tenant retargeting of ctx"): no MCP handler or service
 * may rebuild a ServiceCtx pointing at a different workspace. ctx.role and token
 * confinement describe the workspace the middleware resolved; swapping workspaceId
 * after the fact bypasses both (that is exactly how delete_workspace deleted other
 * tenants' workspaces). Runs in node because it reads source off disk.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vite-plus/test'

const SRC = join(import.meta.dirname, '..', '..')
const COMMANDS = join(SRC, '..', 'services', 'commands')
const RETARGET = /\{\s*\.\.\.ctx\s*,\s*workspaceId\s*:/u

const tsFiles = function tsFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => join(dir, file))
}

describe('no ServiceCtx workspace retargeting', () => {
  test('covers API MCP handlers and shared commands never spread ctx with a new workspaceId', () => {
    const offenders = [...tsFiles(join(SRC, 'mcp')), ...tsFiles(COMMANDS), ...tsFiles(join(SRC, 'services'))].filter(
      (file) => RETARGET.test(readFileSync(file, 'utf8')),
    )
    expect(offenders).toStrictEqual([])
  })
})
