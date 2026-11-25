import { z } from 'zod'

import { objectInOrder } from './common.ts'

export const GetCodeHeatmapSchema = objectInOrder([
  ['projectId', z.string().nonempty()],
  ['since', z.number().int().nonnegative().optional()],
  ['until', z.number().int().nonnegative().optional()],
  /*
   * Drill-down cursor: aggregate the next path segment under this directory. Root call
   * omits it (or passes "") to see top-level segments.
   */
  ['prefix', z.string().optional()],
  ['mode', z.enum(['claims', 'contention']).optional()],
])
