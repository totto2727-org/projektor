import { Worker } from 'alchemy/Cloudflare/Workers'

import type { CoreShape } from '../core/contract.ts'

/** Symbolic identity only. Runtime consumers must not import deployment composition. */
export class Core extends Worker<Core, CoreShape>()('Core') {}
