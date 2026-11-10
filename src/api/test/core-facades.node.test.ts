import { makeRpcStub } from 'alchemy/Cloudflare/Workers'
import { Effect, Schema } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

import { coreFailure, coreReply } from '../../core/contract'
import { apiReply } from '../services/reply'

const PublicIssue = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  links: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
})

// These substitute bindings test adapter execution, not workerd/native binding acceptance.
function clientFor(wire: () => Promise<string>) {
  return makeRpcStub<{ load(): Effect.Effect<string> }>({ load: wire })
}

const issue = { id: 'issue', title: 'Public issue', links: [{ id: 'linked', title: 'Linked issue' }] }

describe('API facade reply boundary', () => {
  it('preserves the declared public success fields', async () => {
    const client = clientFor(() => Effect.runPromise(coreReply('load', PublicIssue, Effect.succeed(issue))))
    await expect(apiReply(PublicIssue, client.load())).resolves.toEqual(issue)
  })

  it('rejects a success value that violates the operation output codec', async () => {
    const client = clientFor(async () =>
      JSON.stringify({ _tag: 'Success', success: { ...issue, links: 'private SQL' } }),
    )
    await expect(apiReply(PublicIssue, client.load())).rejects.toMatchObject({
      _tag: 'CorePublicError',
      status: 502,
      message: 'The Core service returned an invalid response.',
    })
  })

  it('preserves selected public conflict details without reviving an original error', async () => {
    const failure = coreFailure(409, 'Revision changed', {
      kind: 'conflict',
      details: { currentRevisionId: 'revision', diff: 'public diff' },
      retryAfter: 4,
    })
    const client = clientFor(() => Effect.runPromise(coreReply('update', PublicIssue, Effect.fail(failure))))
    await expect(apiReply(PublicIssue, client.load())).rejects.toMatchObject({
      _tag: 'CorePublicError',
      status: 409,
      kind: 'conflict',
      message: 'Revision changed',
      details: { currentRevisionId: 'revision', diff: 'public diff' },
      retryAfter: 4,
      occurrenceId: failure.occurrenceId,
    })
    await expect(apiReply(PublicIssue, client.load())).rejects.not.toHaveProperty('originalError')
  })

  it('sanitizes a transport failure instead of exposing native diagnostics', async () => {
    const client = clientFor(async () => {
      throw new Error('private storage diagnostic')
    })
    await expect(apiReply(PublicIssue, client.load())).rejects.toMatchObject({
      _tag: 'CorePublicError',
      status: 502,
      message: 'The Core service is temporarily unavailable.',
    })
    await expect(apiReply(PublicIssue, client.load())).rejects.not.toHaveProperty('originalError')
  })

  it('keeps concurrent contexts bound to their respective services', async () => {
    const first = clientFor(() =>
      Effect.runPromise(coreReply('load', PublicIssue, Effect.succeed({ ...issue, id: 'first' }))),
    )
    const second = clientFor(() =>
      Effect.runPromise(coreReply('load', PublicIssue, Effect.succeed({ ...issue, id: 'second' }))),
    )
    await expect(
      Promise.all([apiReply(PublicIssue, first.load()), apiReply(PublicIssue, second.load())]),
    ).resolves.toEqual([
      { ...issue, id: 'first' },
      { ...issue, id: 'second' },
    ])
  })
})
