import { makeRpcStub, WorkerEnvironment } from 'alchemy/Cloudflare/Workers'
import { Cause, Effect, Exit, Schema } from 'effect'
import { describe, expect, it, vi } from 'vite-plus/test'

import { decodeCoreReply } from './client'
import { coreFailure, coreReply } from './contract'

const Success = Schema.Struct({ id: Schema.String })

describe('Core native RPC public boundary', () => {
  it('round trips a validated success through the SDK native envelope', async () => {
    const binding = {
      load: async () => Effect.runPromise(coreReply('load', Success, Effect.succeed({ id: 'project' }))),
    }
    const client = makeRpcStub<{ load(): Effect.Effect<string> }>(binding)
    await expect(Effect.runPromise(decodeCoreReply(Success, client.load()))).resolves.toEqual({ id: 'project' })
  })

  it('returns only explicitly selected public failure fields', async () => {
    const publicError = coreFailure(403, 'Forbidden')
    const wire = await Effect.runPromise(coreReply('load', Success, Effect.fail(publicError)))
    expect(JSON.parse(wire)).toEqual({
      _tag: 'Failure',
      failure: {
        status: 403,
        message: 'Forbidden',
        occurrenceId: publicError.occurrenceId,
      },
    })
    const result = await Effect.runPromise(Effect.flip(decodeCoreReply(Success, Effect.succeed(wire))))
    expect(result.status).toBe(403)
    expect(result.message).toBe('Forbidden')
  })

  it.each(['checked', 'defect', 'outbound codec'] as const)('logs %s diagnostics only at the origin', async (kind) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const secret = 'private-sql-credential'
      const effect =
        kind === 'checked'
          ? Effect.fail(new Error(secret))
          : kind === 'defect'
            ? Effect.die(new Error(secret))
            : Effect.succeed({ id: 42 } as unknown as { id: string })
      const wire = await Effect.runPromise(coreReply('load', Success, effect))
      expect(wire).not.toContain(secret)
      const problem = JSON.parse(wire).failure
      expect(problem.status).toBe(500)
      expect(problem.message).toBe('An unexpected error occurred.')
      expect(problem.occurrenceId).toMatch(/^urn:uuid:/)
      expect(log).toHaveBeenCalledTimes(1)
    } finally {
      log.mockRestore()
    }
  })

  it('discards secret-bearing malformed peer responses', async () => {
    const secret = 'private-malformed-wire'
    const result = await Effect.runPromise(Effect.flip(decodeCoreReply(Success, Effect.succeed(secret))))
    expect(result.status).toBe(502)
    expect(JSON.stringify(result)).not.toContain(secret)
  })

  it('preserves only schema-validated public domain metadata', async () => {
    const error = coreFailure(409, 'Conflict', {
      kind: 'conflict',
      details: { currentRevisionId: 'revision', diff: 'public diff' },
      retryAfter: 5,
    })
    const wire = await Effect.runPromise(coreReply('update', Success, Effect.fail(error)))
    const result = await Effect.runPromise(Effect.flip(decodeCoreReply(Success, Effect.succeed(wire))))
    expect(result).toMatchObject({
      status: 409,
      kind: 'conflict',
      details: { currentRevisionId: 'revision', diff: 'public diff' },
      retryAfter: 5,
    })
  })

  it('rejects malformed success payloads without including them in the local failure', async () => {
    const wire = JSON.stringify({ _tag: 'Success', success: { id: { private: 'secret' } } })
    const result = await Effect.runPromise(Effect.flip(decodeCoreReply(Success, Effect.succeed(wire))))
    expect(result.status).toBe(502)
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('treats mixed defect and checked failures as unexpected at the origin', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const cause = Cause.combine(Cause.fail(coreFailure(403, 'Forbidden')), Cause.die(new Error('private defect')))
      const wire = await Effect.runPromise(coreReply('load', Success, Effect.failCause(cause)))
      expect(JSON.parse(wire).failure.status).toBe(500)
      expect(wire).not.toContain('private defect')
      expect(log).toHaveBeenCalledTimes(1)
    } finally {
      log.mockRestore()
    }
  })

  it('sanitizes a malformed application error instead of leaking an encoder defect', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const wire = await Effect.runPromise(
        coreReply('load', Success, Effect.fail(coreFailure(999, 'private bad status'))),
      )
      expect(JSON.parse(wire).failure.status).toBe(500)
      expect(wire).not.toContain('private bad status')
      expect(log).toHaveBeenCalledTimes(1)
    } finally {
      log.mockRestore()
    }
  })

  it('sanitizes native SDK errors before application reply decoding', async () => {
    const secret = 'private-native-error'
    const binding = {
      load: async () => {
        throw new Error(secret)
      },
    }
    const client = makeRpcStub<{ load(): Effect.Effect<string> }>(binding)
    const result = await Effect.runPromise(Effect.flip(decodeCoreReply(Success, client.load())))
    expect(result.status).toBe(502)
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(result.message).toBe('The Core service is temporarily unavailable.')
  })

  it('preserves interruption rather than returning an application failure', async () => {
    const reply = await Effect.runPromiseExit(coreReply('load', Success, Effect.interrupt))
    expect(Exit.isFailure(reply) && Cause.hasInterruptsOnly(reply.cause)).toBe(true)
    const decoded = await Effect.runPromiseExit(decodeCoreReply(Success, Effect.interrupt))
    expect(Exit.isFailure(decoded) && Cause.hasInterruptsOnly(decoded.cause)).toBe(true)
  })

  it('resolves distinct invocation bindings after a single client construction', async () => {
    const client = makeRpcStub<{ load(): Effect.Effect<string, never, WorkerEnvironment> }>(
      WorkerEnvironment.pipe(Effect.map((env) => env.CORE)),
    )
    const invocation = (id: string) =>
      decodeCoreReply(Success, client.load()).pipe(
        Effect.provideService(WorkerEnvironment, {
          CORE: { load: async () => Effect.runPromise(coreReply('load', Success, Effect.succeed({ id }))) },
        }),
      )
    await expect(Promise.all(['first', 'second'].map((id) => Effect.runPromise(invocation(id))))).resolves.toEqual([
      { id: 'first' },
      { id: 'second' },
    ])
  })
})
