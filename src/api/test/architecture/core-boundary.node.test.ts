import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve } from 'node:path'

import * as ts from 'typescript/unstable/ast'
import { createVirtualFileSystem } from 'typescript/unstable/fs'
import { API } from 'typescript/unstable/sync'
import { describe, expect, it } from 'vite-plus/test'
import { z } from 'zod'

const ROOT = resolve(import.meta.dirname, '../../../..')
const SOURCE = join(ROOT, 'src')
const ENTRYPOINTS = ['src/api/index.ts', 'src/web/worker.ts', 'src/web/entry.effront.tsx']
const packageDefinition = z
  .object({
    name: z.string(),
    imports: z.record(z.string(), z.string()),
    exports: z.record(z.string(), z.string()),
  })
  .parse(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')))
const packageImports = packageDefinition.imports
const STORAGE_CAPABILITIES = new Set(['DB', 'KV', 'R2'])

interface ModuleInfo {
  readonly imports: string[]
  readonly capabilities: string[]
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(path) && !/\.(test|d)\.tsx?$/.test(path) ? [path] : []
  })
}

function analyze(sources: Readonly<Record<string, string>>): Map<string, ModuleInfo> {
  const configFile = join(ROOT, 'tsconfig.core-boundary.json')
  const api = new API({
    fs: createVirtualFileSystem({
      ...sources,
      [configFile]: JSON.stringify({
        compilerOptions: { target: 'esnext', noLib: true, noResolve: true, types: [], jsx: 'preserve' },
        files: Object.keys(sources),
      }),
    }),
  })
  try {
    const project = api.updateSnapshot({ openProjects: [configFile] }).getProject(configFile)
    if (!project) throw new Error('Could not parse the Core boundary source graph.')
    const graph = new Map<string, ModuleInfo>()
    for (const path of Object.keys(sources)) {
      const source = project.program.getSourceFile(path)
      if (!source) throw new Error(`Could not parse ${path}`)
      const imports: string[] = []
      const capabilities: string[] = []
      const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const clause = node.importClause
          const named = clause?.namedBindings
          const hasValue =
            !clause ||
            (clause.phaseModifier !== ts.SyntaxKind.TypeKeyword &&
              (!!clause.name ||
                !named ||
                ts.isNamespaceImport(named) ||
                named.elements.length === 0 ||
                named.elements.some((element) => !element.isTypeOnly)))
          if (hasValue) imports.push(node.moduleSpecifier.text)
        }
        if (
          ts.isExportDeclaration(node) &&
          !node.isTypeOnly &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          const clause = node.exportClause
          if (!clause || !ts.isNamedExports(clause) || clause.elements.some((element) => !element.isTypeOnly)) {
            imports.push(node.moduleSpecifier.text)
          }
        }
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const argument = node.arguments[0]
          if (argument && ts.isStringLiteral(argument)) imports.push(argument.text)
          else capabilities.push('non-literal dynamic import prevents static boundary verification')
        }
        if (ts.isPropertyAccessExpression(node) && STORAGE_CAPABILITIES.has(node.name.text)) {
          capabilities.push(`direct .${node.name.text} capability`)
        }
        if (
          ts.isElementAccessExpression(node) &&
          ts.isStringLiteral(node.argumentExpression) &&
          STORAGE_CAPABILITIES.has(node.argumentExpression.text)
        ) {
          capabilities.push(`direct [${node.argumentExpression.text}] capability`)
        }
        if (ts.isBindingElement(node)) {
          const key = node.propertyName ?? node.name
          if (key && (ts.isIdentifier(key) || ts.isStringLiteral(key)) && STORAGE_CAPABILITIES.has(key.text)) {
            capabilities.push(`destructured ${key.text} capability`)
          }
        }
        node.forEachChild(visit)
      }
      visit(source)
      graph.set(normalize(path), { imports, capabilities })
    }
    return graph
  } finally {
    api.close()
  }
}

function resolveModule(from: string, specifier: string, graph: ReadonlyMap<string, ModuleInfo>): string | undefined {
  let target: string | undefined
  if (specifier.startsWith('.')) target = resolve(dirname(from), specifier)
  else if (specifier.startsWith('@/')) target = join(SOURCE, 'web', specifier.slice(2))
  else if (specifier === packageDefinition.name || specifier.startsWith(`${packageDefinition.name}/`)) {
    const key = specifier === packageDefinition.name ? '.' : `.${specifier.slice(packageDefinition.name.length)}`
    const exported = packageDefinition.exports[key]
    if (!exported) throw new Error(`Unresolved self-reference ${specifier} from ${relative(ROOT, from)}`)
    target = resolve(ROOT, exported)
  } else if (specifier.startsWith('#')) {
    const exact = packageImports[specifier]
    if (exact) target = resolve(ROOT, exact)
    else {
      for (const [pattern, replacement] of Object.entries(packageImports)) {
        const wildcard = pattern.indexOf('*')
        if (wildcard < 0) continue
        const prefix = pattern.slice(0, wildcard)
        const suffix = pattern.slice(wildcard + 1)
        if (specifier.startsWith(prefix) && specifier.endsWith(suffix)) {
          target = resolve(
            ROOT,
            replacement.replace('*', specifier.slice(prefix.length, suffix ? -suffix.length : undefined)),
          )
          break
        }
      }
    }
  }
  if (!target) return undefined
  if (/\.(css|json|svg|png|webp|woff2)$/.test(target) && existsSync(target)) return undefined
  const candidates = [target, `${target}.ts`, `${target}.tsx`, join(target, 'index.ts'), join(target, 'index.tsx')]
  const found = candidates.find((candidate) => graph.has(candidate))
  if (!found) throw new Error(`Unresolved application import ${specifier} from ${relative(ROOT, from)}`)
  return found
}

function violations(graph: ReadonlyMap<string, ModuleInfo>, entrypoints: readonly string[]): string[] {
  const failures: string[] = []
  const visited = new Set<string>()
  const walk = (path: string, chain: readonly string[]): void => {
    if (visited.has(path)) return
    visited.add(path)
    const info = graph.get(path)
    if (!info) throw new Error(`Missing application entrypoint ${path}`)
    const localPath = relative(ROOT, path)
    const next = [...chain, localPath]
    if (/^src\/(services|db|plugins|plugin-sdk)\//.test(localPath)) {
      failures.push(`${next.join(' -> ')}: Core implementation reached from a public adapter`)
      return
    }
    for (const capability of info.capabilities) failures.push(`${next.join(' -> ')}: ${capability}`)
    for (const specifier of info.imports) {
      if (/^(drizzle-orm(?:\/|$)|node:sqlite$)/.test(specifier)) {
        failures.push(`${next.join(' -> ')} -> ${specifier}: database runtime imported by a public adapter`)
        continue
      }
      const dependency = resolveModule(path, specifier, graph)
      if (dependency) walk(dependency, next)
    }
  }
  for (const entrypoint of entrypoints) walk(resolve(ROOT, entrypoint), [])
  return failures
}

function reverseViolations(graph: ReadonlyMap<string, ModuleInfo>): string[] {
  const failures: string[] = []
  for (const [path, info] of graph) {
    const localPath = relative(ROOT, path)
    if (!/^src\/(core|contracts|services|db|plugins|plugin-sdk)\//.test(localPath)) continue
    for (const specifier of info.imports) {
      const dependency = resolveModule(path, specifier, graph)
      if (dependency && /^src\/(api|web)\//.test(relative(ROOT, dependency))) {
        failures.push(
          `${localPath} -> ${relative(ROOT, dependency)}: shared implementation depends on a public adapter`,
        )
      }
    }
  }
  return failures
}

describe('private Core ownership', () => {
  it('public API and Effront runtime graphs cannot reach storage or domain implementations', () => {
    const files = sourceFiles(SOURCE)
    const sources = Object.fromEntries(files.map((path) => [path, readFileSync(path, 'utf8')]))
    const graph = analyze(sources)
    expect([...violations(graph, ENTRYPOINTS), ...reverseViolations(graph)]).toEqual([])
  })

  it('follows value re-exports and dynamic imports but ignores erased type imports', () => {
    const entry = join(SOURCE, 'api', 'boundary-fixture.ts')
    const barrel = join(SOURCE, 'core', 'boundary-fixture.ts')
    const domain = join(SOURCE, 'services', 'boundary-fixture.ts')
    const source = (text: string) =>
      analyze({
        [entry]: text,
        [barrel]: "export { query } from '../services/boundary-fixture'",
        [domain]: 'export const query = () => undefined',
      })
    expect(violations(source("import type { query } from '../core/boundary-fixture'"), [entry])).toEqual([])
    expect(violations(source("import { type query } from '../core/boundary-fixture'"), [entry])).toEqual([])
    expect(violations(source("import { query } from '../core/boundary-fixture'"), [entry])).toHaveLength(1)
    expect(violations(source("import * as domain from '../core/boundary-fixture'"), [entry])).toHaveLength(1)
    expect(violations(source("import domain from '../core/boundary-fixture'"), [entry])).toHaveLength(1)
    expect(violations(source("import '../core/boundary-fixture'"), [entry])).toHaveLength(1)
    expect(violations(source("export { query } from '../core/boundary-fixture'"), [entry])).toEqual([
      'src/api/boundary-fixture.ts -> src/core/boundary-fixture.ts -> src/services/boundary-fixture.ts: Core implementation reached from a public adapter',
    ])
    expect(violations(source("void import('../core/boundary-fixture')"), [entry])).toHaveLength(1)
    expect(violations(source('void env.DB.prepare("SELECT 1")'), [entry])).toEqual([
      'src/api/boundary-fixture.ts: direct .DB capability',
    ])
    expect(violations(source("void env['DB']"), [entry])).toHaveLength(1)
    expect(violations(source('const { DB: database } = env'), [entry])).toHaveLength(1)
    expect(violations(source('const { R2 } = env'), [entry])).toHaveLength(1)
    expect(violations(source('void env.KV.get("key")'), [entry])).toHaveLength(1)
  })

  it('rejects shared runtime dependencies on adapters without rejecting shared type references', () => {
    const adapter = join(SOURCE, 'web', 'boundary-fixture.ts')
    const shared = join(SOURCE, 'contracts', 'boundary-fixture.ts')
    const source = (text: string) =>
      analyze({
        [adapter]: 'export const value = 1',
        [shared]: text,
      })
    expect(reverseViolations(source("import type { value } from '../web/boundary-fixture'"))).toEqual([])
    expect(reverseViolations(source("export { value } from '../web/boundary-fixture'"))).toEqual([
      'src/contracts/boundary-fixture.ts -> src/web/boundary-fixture.ts: shared implementation depends on a public adapter',
    ])
    expect(reverseViolations(source("void import('../web/boundary-fixture')"))).toHaveLength(1)
  })

  it('follows the package self-reference used by the native client prebundle', () => {
    const entry = join(SOURCE, 'api', 'boundary-fixture.ts')
    const client = join(SOURCE, 'core', 'client.ts')
    const domain = join(SOURCE, 'services', 'boundary-fixture.ts')
    const graph = analyze({
      [entry]: "import { query } from 'projektor/core-client'",
      [client]: "export { query } from '../services/boundary-fixture'",
      [domain]: 'export const query = () => undefined',
    })
    expect(violations(graph, [entry])).toEqual([
      'src/api/boundary-fixture.ts -> src/core/client.ts -> src/services/boundary-fixture.ts: Core implementation reached from a public adapter',
    ])
  })
})
