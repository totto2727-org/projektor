import { Effect, Result, Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
} from '#commands/errors.ts'
import { coreReply, coreReplyCodec } from '#core/contract.ts'
import { publicDomainFailure } from '#core/domain-errors.ts'

const success = Schema.Struct({ ok: Schema.Literal(true) })
const failure = async function failure(cause: unknown) {
  const encoded = await Effect.runPromise(
    coreReply('testBrowserCommand', success, Effect.fail(publicDomainFailure(cause))),
  )
  const decoded = Schema.decodeUnknownSync(coreReplyCodec(success))(encoded)
  if (Result.isSuccess(decoded)) {
    throw new Error('Expected encoded failure')
  }
  return { problem: decoded.failure, encoded }
}
describe('private Core browser command failure boundary', () => {
  test.each([
    [new ValidationError({ formErrors: ['Name is required'], fieldErrors: {} }), 400, 'Validation failed'],
    [new NotFoundError('Missing', { headings: ['Title'] }), 404, 'Missing'],
    [new ForbiddenError('Denied'), 403, 'Denied'],
    [new ConflictError('Conflict', { currentRevisionId: 'revision' }), 409, 'Conflict'],
    [new PayloadTooLargeError(), 413, 'Payload too large'],
    [new UnsupportedMediaTypeError(), 415, 'Unsupported media type'],
  ] as const)(
    'preserves expected domain failure without credential diagnostics: %o',
    async (cause, status, message) => {
      const { problem, encoded } = await failure(cause)
      expect(problem).toMatchObject({ status, message })
      expect(problem.occurrenceId).toMatch(/^urn:uuid:/)
      if (cause instanceof NotFoundError || cause instanceof ConflictError) {
        expect(problem.details).toEqual(cause.details)
      }
      expect(encoded).not.toContain('SQL/token')
    },
  )

  test('redacts unexpected SQL and arbitrary attached details at the origin', async () => {
    const { problem, encoded } = await failure(
      Object.assign(new Error('private SQL/token/binding'), { details: { token: 'private-secret' } }),
    )
    expect(problem).toMatchObject({ status: 500, message: 'An unexpected error occurred.' })
    expect(problem).not.toHaveProperty('details')
    expect(encoded).not.toContain('private')
  })
})
