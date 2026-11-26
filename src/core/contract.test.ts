import { makeRpcStub, WorkerEnvironment } from 'alchemy/Cloudflare/Workers'
import { Cause, Effect, Exit, Function, Schema } from 'effect'
import { describe, expect, test, vi } from 'vite-plus/test'

import { runTestEffect } from '#tests/run-effect.ts'

import { decodeCoreReply } from './client.ts'
import { coreFailure, coreReply } from './contract.ts'

const Success = Schema.Struct({ id: Schema.String })

describe('core native RPC public boundary', () => {
  test('round trips a validated success through the SDK native envelope', async () => {
    const binding = {
      load: async () => runTestEffect(coreReply('load', Success, Effect.succeed({ id: 'project' }))),
    }
    const client = makeRpcStub<{ load(): Effect.Effect<string> }>(binding)
    await expect(runTestEffect(decodeCoreReply(Success, client.load()))).resolves.toStrictEqual({ id: 'project' })
  })

  test('returns only explicitly selected public failure fields', async () => {
    const publicError = coreFailure(403, 'Forbidden')
    const wire = await runTestEffect(coreReply('load', Success, Effect.fail(publicError)))
    expect(JSON.parse(wire)).toStrictEqual({
      _tag: 'Failure',
      failure: {
        status: 403,
        message: 'Forbidden',
        occurrenceId: publicError.occurrenceId,
      },
    })
    const result = await runTestEffect(Effect.flip(decodeCoreReply(Success, Effect.succeed(wire))))
    expect(result.status).toBe(403)
    expect(result.message).toBe('Forbidden')
  })

  test.each([
    ['checked', (secret: string) => Effect.fail(new Error(secret))],
    ['defect', (secret: string) => Effect.die(new Error(secret))],
    ['outbound codec', () => Effect.succeed({ id: 42 } as unknown as { id: string })],
  ] as const)('logs %s diagnostics only at the origin', async (_kind, makeEffect) => {
    const log = vi.spyOn(console, 'error').mockImplementation(Function.constVoid)
    try {
      const secret = 'private-sql-credential'
      const effect = makeEffect(secret)
      const wire = await runTestEffect(coreReply('load', Success, effect))
      expect(wire).not.toContain(secret)
      const problem = JSON.parse(wire).failure
      expect(problem.status).toBe(500)
      expect(problem.message).toBe('An unexpected error occurred.')
      expect(problem.occurrenceId).toMatch(/^urn:uuid:/u)
      expect(log).toHaveBeenCalledOnce()
    } finally {
      log.mockRestore()
    }
  })

  test('discards secret-bearing malformed peer responses', async () => {
    const secret = 'private-malformed-wire'
    const result = await runTestEffect(Effect.flip(decodeCoreReply(Success, Effect.succeed(secret))))
    expect(result.status).toBe(502)
    expect(JSON.stringify(result)).not.toContain(secret)
  })

  test('preserves only schema-validated public domain metadata', async () => {
    const error = coreFailure(409, 'Conflict', {
      kind: 'conflict',
      details: { currentRevisionId: 'revision', diff: 'public diff' },
      retryAfter: 5,
    })
    const wire = await runTestEffect(coreReply('update', Success, Effect.fail(error)))
    const result = await runTestEffect(Effect.flip(decodeCoreReply(Success, Effect.succeed(wire))))
    expect(result).toMatchObject({
      details: { currentRevisionId: 'revision', diff: 'public diff' },
      kind: 'conflict',
      retryAfter: 5,
      status: 409,
    })
  })

  test('rejects malformed success payloads without including them in the local failure', async () => {
    const wire = JSON.stringify({ _tag: 'Success', success: { id: { private: 'secret' } } })
    const result = await runTestEffect(Effect.flip(decodeCoreReply(Success, Effect.succeed(wire))))
    expect(result.status).toBe(502)
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  test('treats mixed defect and checked failures as unexpected at the origin', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(Function.constVoid)
    try {
      const cause = Cause.combine(Cause.fail(coreFailure(403, 'Forbidden')), Cause.die(new Error('private defect')))
      const wire = await runTestEffect(coreReply('load', Success, Effect.failCause(cause)))
      expect(JSON.parse(wire).failure.status).toBe(500)
      expect(wire).not.toContain('private defect')
      expect(log).toHaveBeenCalledOnce()
    } finally {
      log.mockRestore()
    }
  })

  test('sanitizes a malformed application error instead of leaking an encoder defect', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(Function.constVoid)
    try {
      const wire = await runTestEffect(coreReply('load', Success, Effect.fail(coreFailure(999, 'private bad status'))))
      expect(JSON.parse(wire).failure.status).toBe(500)
      expect(wire).not.toContain('private bad status')
      expect(log).toHaveBeenCalledOnce()
    } finally {
      log.mockRestore()
    }
  })

  test('sanitizes native SDK errors before application reply decoding', async () => {
    const secret = 'private-native-error'
    const binding = {
      load: async () => {
        throw new Error(secret)
      },
    }
    const client = makeRpcStub<{ load(): Effect.Effect<string> }>(binding)
    const result = await runTestEffect(Effect.flip(decodeCoreReply(Success, client.load())))
    expect(result.status).toBe(502)
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(result.message).toBe('The Core service is temporarily unavailable.')
  })

  test.each([
    ['transport', () => Effect.fail(new Error('private detail'))],
    ['reply', () => Effect.succeed('invalid wire')],
  ] as const)('records safe %s correlation without copying private diagnostics', async (stage, makeInvocation) => {
    const log = vi.spyOn(console, 'error').mockImplementation(Function.constVoid)
    try {
      const invocation = makeInvocation()
      const problem = await runTestEffect(Effect.flip(decodeCoreReply(Success, invocation)))
      expect(problem).toMatchObject({ status: 502 })
      expect(JSON.stringify(problem)).not.toContain('private detail')
      expect(JSON.stringify(problem)).not.toContain('invalid wire')
      expect(log).toHaveBeenCalledWith('[core-client]', { stage, occurrenceId: problem.occurrenceId })
      expect(JSON.stringify(log.mock.calls)).not.toContain('private detail')
      expect(JSON.stringify(log.mock.calls)).not.toContain('invalid wire')
    } finally {
      log.mockRestore()
    }
  })

  test('preserves interruption rather than returning an application failure', async () => {
    const isOnlyInterruption = Exit.match({
      onFailure: Cause.hasInterruptsOnly,
      onSuccess: Function.constFalse,
    })
    const replyEffect = coreReply('load', Success, Effect.interrupt)
    const reply = await runTestEffect(Effect.exit(replyEffect))
    expect(isOnlyInterruption(reply)).toBe(true)
    const decodeEffect = decodeCoreReply(Success, Effect.interrupt)
    const decoded = await runTestEffect(Effect.exit(decodeEffect))
    expect(isOnlyInterruption(decoded)).toBe(true)
  })

  test('resolves distinct invocation bindings after a single client construction', async () => {
    const client = makeRpcStub<{ load(): Effect.Effect<string, never, WorkerEnvironment> }>(
      WorkerEnvironment.pipe(Effect.map((env) => env.CORE)),
    )
    const invocation = (id: string) =>
      decodeCoreReply(Success, client.load()).pipe(
        Effect.provideService(WorkerEnvironment, {
          CORE: { load: async () => runTestEffect(coreReply('load', Success, Effect.succeed({ id }))) },
        }),
      )
    await expect(Promise.all(['first', 'second'].map((id) => runTestEffect(invocation(id))))).resolves.toStrictEqual([
      { id: 'first' },
      { id: 'second' },
    ])
  })
})
