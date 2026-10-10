import { Application } from '@effront/core'

import type { RequestServices } from './request'

export const EFFRONT = Application.effront<RequestServices>()
