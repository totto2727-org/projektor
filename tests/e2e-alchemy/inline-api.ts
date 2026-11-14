import { mkdir, readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as Plugin from '@alchemy.run/cloudflare-runtime/core/Plugin'
import * as PluginContext from '@alchemy.run/cloudflare-runtime/core/PluginContext'
import type * as RuntimeServices from '@alchemy.run/cloudflare-runtime/core/RuntimeServices'
import type * as WorkerdConfig from '@alchemy.run/cloudflare-runtime/core/workerd/Config'
import { Effect, Layer } from 'effect'

import { deployment } from '../../worker-graph'
import { apiWorkerOptions, coreServiceBinding, coreWorkerOptions, fixtureServices } from './api-host'

const apiStorage = 'projektor-e2e-api-do-storage'
const loopbackNetwork = 'projektor-e2e-loopback-only'

/** Public runtime extension hosts both actual backend artifacts in the frontend workerd. */
export class InlineApi extends Plugin.Service<
  InlineApi,
  { readonly bind: PluginContext.BindingHook<RuntimeServices.BindingServices> }
>()('cloudflare-runtime/plugin/ProjektorInlineApi') {}

export const inlineCoreBinding = Plugin.use(InlineApi, (plugin) => plugin.api.bind)

/** Read official build artifacts unchanged. Entry module must be first for workerd. */
async function readWorkerModules(directory: string, entryName: string): Promise<WorkerdConfig.Worker_Module[]> {
  const files = await readdir(directory, { recursive: true, withFileTypes: true })
  const modules: WorkerdConfig.Worker_Module[] = []
  for (const entry of files.filter((file) => file.isFile())) {
    const file = join(entry.parentPath, entry.name)
    const name = relative(directory, file).replaceAll('\\', '/')
    const extension = extname(file)
    if (extension === '.map') continue
    if (extension === '.js' || extension === '.mjs') {
      modules.push({ name, esModule: await readFile(file, 'utf8') })
    } else if (extension === '.cjs') {
      modules.push({ name, commonJsModule: await readFile(file, 'utf8') })
    } else if (extension === '.json') {
      modules.push({ name, json: await readFile(file, 'utf8') })
    } else if (extension === '.wasm') {
      modules.push({ name, wasm: await readFile(file) })
    } else if (['.txt', '.html', '.css'].includes(extension)) {
      modules.push({ name, text: await readFile(file, 'utf8') })
    } else {
      throw new Error(`Unsupported official Worker build module: ${name}`)
    }
  }
  const index = modules.findIndex((module) => module.name === entryName)
  if (index < 0) throw new Error(`Build the official Worker artifact before previewing: ${entryName}`)
  const [entry] = modules.splice(index, 1)
  if (!entry) throw new Error(`The official Worker entry module is missing: ${entryName}`)
  return [entry, ...modules]
}

export async function makeInlineApiLayer(directory: string) {
  const [apiModules, coreModules] = await Promise.all([
    readWorkerModules(fileURLToPath(new URL('./dist/ssr/', import.meta.url)), 'api.worker.js'),
    readWorkerModules(fileURLToPath(new URL('./core-dist/ssr/', import.meta.url)), 'core.worker.js'),
  ])
  const doDirectory = join(directory, 'api-do')
  await mkdir(doDirectory, { recursive: true })
  let apiBindings: WorkerdConfig.Worker_Binding[] | undefined
  let coreBindings: WorkerdConfig.Worker_Binding[] | undefined
  return Layer.succeed(
    InlineApi,
    InlineApi.of({
      api: {
        bind: Effect.gen(function* () {
          const context = yield* PluginContext.PluginContext
          // Resolve native storage hooks only for Core, in this runtime's plugin map.
          coreBindings = yield* Effect.all(coreWorkerOptions.bindings)
          apiBindings = yield* Effect.all(apiWorkerOptions.bindings).pipe(
            Effect.provideService(PluginContext.PluginContext, {
              ...context,
              worker: {
                ...apiWorkerOptions,
                compatibilityDate: deployment.api.compatibility.date,
                compatibilityFlags: deployment.api.compatibility.flags,
                modules: [],
              },
            }),
          )
          for (const binding of apiBindings) {
            if (binding.name !== undefined && ['DB', 'KV', 'R2'].includes(binding.name)) {
              throw new Error(`Public API fixture unexpectedly received storage: ${binding.name}`)
            }
          }
          return yield* coreServiceBinding
        }),
      },
      defer: Effect.sync((): Plugin.PluginConfig => {
        if (!apiBindings || !coreBindings) throw new Error('The native three-Worker graph was not initialized.')
        return {
          userWorker: { globalOutbound: { name: loopbackNetwork } },
          services: [
            { name: loopbackNetwork, network: { allow: ['127.0.0.1/32', '::1/128'] } },
            { name: apiStorage, disk: { path: doDirectory, writable: true } },
            {
              name: fixtureServices.core,
              worker: {
                modules: coreModules,
                compatibilityDate: deployment.core.compatibility.date,
                compatibilityFlags: deployment.core.compatibility.flags,
                bindings: coreBindings,
                globalOutbound: { name: loopbackNetwork },
              },
            },
            {
              name: fixtureServices.api,
              worker: {
                modules: apiModules,
                compatibilityDate: deployment.api.compatibility.date,
                compatibilityFlags: deployment.api.compatibility.flags,
                bindings: apiBindings,
                globalOutbound: { name: loopbackNetwork },
                durableObjectStorage: { localDisk: apiStorage },
                durableObjectNamespaces: apiWorkerOptions.durableObjectNamespaces.map((namespace) => ({
                  className: namespace.className,
                  enableSql: namespace.sql,
                  uniqueKey: `projektor-e2e-api-${namespace.className}`,
                })),
              },
            },
          ],
          // Only API has a fixture socket. Core has no public or loopback HTTP listener.
          sockets: [
            {
              name: 'projektor-e2e-api-fixture',
              address: '127.0.0.1:4392',
              service: { name: fixtureServices.api },
              http: {},
            },
          ],
        }
      }),
    }),
  )
}
