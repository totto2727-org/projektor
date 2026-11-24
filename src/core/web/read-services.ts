import { Context } from 'effect'

import type { CoreEnvironment } from '#core/environment.ts'

export class CoreReadServices extends Context.Service<
  CoreReadServices,
  {
    readonly db: CoreEnvironment['DB']
  }
>()('projektor/core/web/ReadServices') {}
