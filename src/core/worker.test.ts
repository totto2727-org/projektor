import type { WorkerEnvironment, WorkerExecutionContext } from 'alchemy/Cloudflare/Workers'
import type { Effect } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

import type { makeCoreHandlers } from './worker'

// Type-only imports keep native Worker code out of the Node-only type regression.
type IsAny<T> = 0 extends 1 & T ? true : false
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type ResolveWorkspace = ReturnType<Effect.Success<typeof makeCoreHandlers>['apiResolveWorkspace']>

const constructionIsTyped: IsAny<Effect.Success<typeof makeCoreHandlers>> = false
const invocationIsTyped: IsAny<Effect.Services<ResolveWorkspace>> = false
const constructionIsBindingFree: Same<Effect.Services<typeof makeCoreHandlers>, never> = true
const invocationIsRequestLocal: Same<
  Effect.Services<ResolveWorkspace>,
  WorkerEnvironment | WorkerExecutionContext
> = true
const wireSuccessIsString: Same<Effect.Success<ResolveWorkspace>, string> = true
const wireErrorIsNever: Same<Effect.Error<ResolveWorkspace>, never> = true

describe('official Core native Worker types', () => {
  it('retains concrete construction, request requirements and encoded reply types', () => {
    expect(constructionIsTyped).toBe(false)
    expect(invocationIsTyped).toBe(false)
    expect(constructionIsBindingFree).toBe(true)
    expect(invocationIsRequestLocal).toBe(true)
    expect(wireSuccessIsString).toBe(true)
    expect(wireErrorIsNever).toBe(true)
  })
})
