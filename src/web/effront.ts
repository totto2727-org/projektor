import { Application } from '@effront/core'

import type { RequestServices } from './request.ts'

export const EFFRONT = Application.effront<RequestServices>()
