import { NodeCrypto } from '@effect/platform-node'
import { Crypto, Effect } from 'effect'
import { Hex } from 'effect/encoding'

export const sha256Hex = (text: string): Promise<string> =>
  Effect.runPromise(
    Crypto.Crypto.use((crypto) => crypto.digest('SHA-256', new TextEncoder().encode(text))).pipe(
      Effect.map(Hex.encode),
      Effect.provide(NodeCrypto.layer),
    ),
  )

export const fixtureUuid = (): string =>
  Effect.runSync(Crypto.Crypto.use((crypto) => crypto.randomUUIDv4()).pipe(Effect.provide(NodeCrypto.layer)))
