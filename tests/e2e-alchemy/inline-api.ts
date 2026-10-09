import { mkdir, readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as Plugin from '@alchemy.run/cloudflare-runtime/core/Plugin'
import * as PluginContext from '@alchemy.run/cloudflare-runtime/core/PluginContext'
import type * as RuntimeServices from '@alchemy.run/cloudflare-runtime/core/RuntimeServices'
import type * as WorkerdConfig from '@alchemy.run/cloudflare-runtime/core/workerd/Config'
import { Effect, Layer } from 'effect'

import { apiWorkerOptions } from './api-host'

const apiService = 'projektor-e2e-api-inline'
const apiStorage = 'projektor-e2e-api-do-storage'
const loopbackNetwork = 'projektor-e2e-loopback-only'

/** Public runtime extension. No Vite/Alchemy bridge patch or second Runtime.start. */
export class InlineApi extends Plugin.Service<
  InlineApi,
  { readonly bind: PluginContext.BindingHook<RuntimeServices.BindingServices> }
>()('cloudflare-runtime/plugin/ProjektorInlineApi') {}

export const inlineApiRateLimiterBinding = Plugin.use(InlineApi, (plugin) => plugin.api.bind)

/** Read the real official API build, entry first, without rewriting its modules. */
async function readApiModules(): Promise<WorkerdConfig.Worker_Module[]> {
  const directory = fileURLToPath(new URL('./dist/ssr/', import.meta.url))
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
      throw new Error(`Unsupported official API build module: ${name}`)
    }
  }
  const index = modules.findIndex((module) => module.name === 'api.worker.js')
  if (index < 0) throw new Error('Build the official API artifact before previewing the E2E host.')
  const [entry] = modules.splice(index, 1)
  if (!entry) throw new Error('The official API entry module is missing.')
  return [entry, ...modules]
}

export async function makeInlineApiLayer(directory: string) {
  const modules = await readApiModules()
  const doDirectory = join(directory, 'api-do')
  await mkdir(doDirectory, { recursive: true })
  let bindings: WorkerdConfig.Worker_Binding[] | undefined
  return Layer.succeed(
    InlineApi,
    InlineApi.of({
      api: {
        bind: Effect.gen(function* () {
          const context = yield* PluginContext.PluginContext
          // Use this SAME plugin map/D1 service. Only the metadata used to
          // validate own-worker DO hooks describes the inline API worker.
          bindings = yield* Effect.all(apiWorkerOptions.bindings).pipe(
            Effect.provideService(PluginContext.PluginContext, {
              ...context,
              worker: {
                ...apiWorkerOptions,
                compatibilityDate: '2026-09-01',
                compatibilityFlags: ['nodejs_compat'],
                modules: [],
              },
            }),
          )
          // Native foreign namespace within this SAME workerd. No Web API
          // service binding and no registry/network proxy for the RateLimiter.
          return {
            name: 'RATE_LIMITER',
            durableObjectNamespace: { className: 'RateLimiter', serviceName: apiService },
          }
        }),
      },
      defer: Effect.sync((): Plugin.PluginConfig => {
        if (!bindings) throw new Error('The inline API RateLimiter binding was not initialized.')
        console.log(
          `[e2e-host] One workerd, two actual user Workers, shared D1/KV/R2/OAuth, native foreign RateLimiter. API modules: ${modules.length}`,
        )
        return {
          userWorker: { globalOutbound: { name: loopbackNetwork } },
          services: [
            { name: loopbackNetwork, network: { allow: ['127.0.0.1/32', '::1/128'] } },
            { name: apiStorage, disk: { path: doDirectory, writable: true } },
            {
              name: apiService,
              worker: {
                modules,
                compatibilityDate: '2026-09-01',
                compatibilityFlags: ['nodejs_compat'],
                bindings,
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
          sockets: [
            {
              name: 'projektor-e2e-api-fixture',
              address: '127.0.0.1:4392',
              service: { name: apiService },
              http: {},
            },
          ],
        }
      }),
    }),
  )
}
