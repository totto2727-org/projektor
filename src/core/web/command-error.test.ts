import { Effect, Result, Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
  validationIssues,
} from '#commands/errors.ts'
import { coreReply, coreReplyCodec } from '#core/contract.ts'
import { publicDomainFailure } from '#core/domain-errors.ts'
import { runTestEffect } from '#tests/run-effect.ts'

const success = Schema.Struct({ ok: Schema.Literal(true) })
const decodeReply = Schema.decodeUnknownResult(coreReplyCodec(success))
const failure = async function failure(cause: unknown) {
  const encoded = await runTestEffect(coreReply('testBrowserCommand', success, Effect.fail(publicDomainFailure(cause))))
  const decoded = Result.getOrThrow(decodeReply(encoded))
  if (Result.isSuccess(decoded)) {
    throw new Error('Expected encoded failure')
  }
  return { problem: decoded.failure, encoded }
}
describe('private Core browser command failure boundary', () => {
  test.each([
    [new ValidationError(validationIssues(['Name is required'], {})), 400, 'Validation failed'],
    [new NotFoundError('Missing', { headings: ['Title'] }), 404, 'Missing'],
    [new ForbiddenError('Denied'), 403, 'Denied'],
    [new ConflictError('Conflict', { currentRevisionId: 'revision' }), 409, 'Conflict'],
    [new PayloadTooLargeError(), 413, 'Payload too large'],
    [new UnsupportedMediaTypeError(), 415, 'Unsupported media type'],
  ] as const)(
    'preserves expected domain failure without credential diagnostics: %o',
    async (cause, status, message) => {
      const { problem, encoded } = await failure(cause)
      expect(problem).toMatchObject({ message, status })
      expect(problem.occurrenceId).toMatch(/^urn:uuid:/u)
      if (cause instanceof NotFoundError || cause instanceof ConflictError) {
        expect(problem.details).toStrictEqual(cause.details)
      }
      expect(encoded).not.toContain('SQL/token')
    },
  )

  test('redacts unexpected SQL and arbitrary attached details at the origin', async () => {
    const { problem, encoded } = await failure(
      Object.assign(new Error('private SQL/token/binding'), { details: { token: 'private-secret' } }),
    )
    expect(problem).toMatchObject({ message: 'An unexpected error occurred.', status: 500 })
    expect(problem).not.toHaveProperty('details')
    expect(encoded).not.toContain('private')
  })
})
