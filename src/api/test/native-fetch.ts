import { exports as workerExports } from 'cloudflare:workers'

export const fetchNativeApi: Fetcher['fetch'] = (request, init) => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The native test project sets api.worker.ts as its main entrypoint.
  const { default: api } = workerExports as { default: Fetcher }
  return api.fetch(request, init)
}
