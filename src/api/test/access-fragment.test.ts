import { Iterable } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { visibleProjectSqlFragment } from '#commands/access.ts'
import type { ServiceCtx } from '#commands/types.ts'

/*
 * PROJ-317: visibleProjectSqlFragment inlines its column expression verbatim into
 * raw SQL, so it must reject anything that isn't a bare/qualified column identifier
 * before it can become an injection vector.
 */

const memberCtx = { role: 'member', userId: 'u1' } as unknown as ServiceCtx
const ownerCtx = { role: 'owner', userId: 'u1' } as unknown as ServiceCtx

describe('visibleProjectSqlFragment column-expression guard', () => {
  test('accepts a bare or table-qualified column identifier', () => {
    expect(visibleProjectSqlFragment(memberCtx, 'project_id')).not.toBeNull()
    const frag = visibleProjectSqlFragment(memberCtx, 'i.project_id')
    expect(frag?.params).toStrictEqual(['u1'])
    expect(frag?.sql).toContain('gpg.project_id = i.project_id')
  })

  test('returns null for owner/admin (no filter) but still validates the expression', () => {
    expect(visibleProjectSqlFragment(ownerCtx, 'i.project_id')).toBeNull()
    expect(() => visibleProjectSqlFragment(ownerCtx, 'i.project_id; DROP TABLE issues')).toThrow(
      'projectColExpr must be a column identifier',
    )
  })

  test('throws on anything that is not a column identifier', () => {
    Iterable.forEach(
      ['i.project_id; DROP TABLE issues', '(SELECT 1)', 'i.project_id OR 1=1', 'i.project_id, name', '', '1'],
      (bad) => {
        expect(() => visibleProjectSqlFragment(memberCtx, bad)).toThrow(/column identifier/u)
      },
    )
  })
})
