import { Worker } from 'alchemy/Cloudflare/Workers'

import type { CoreShape } from '../core/contract'

/** Symbolic identity only. Runtime consumers must not import deployment composition. */
export class Core extends Worker<Core, CoreShape>()('Core') {}
