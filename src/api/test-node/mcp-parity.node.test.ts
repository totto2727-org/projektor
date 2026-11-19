// PROJ-623: mechanical parity across the four tool surfaces.
//
// Parity used to be held by convention plus two hand-written spot checks in mcp.test.ts
// (issues and wiki — 2 of 22 domains), and mcp/catalog.ts carried a comment asking a
// human to keep its order in sync with the runtime registry by hand. This test replaces
// both with a check that fails the build.
//
// The four surfaces:
//   1. service functions   src/services/commands/*.ts — the operations that exist at all
//   2. REST routes         src/api/routes/*.ts   — the browser/HTTP surface
//   3. runtime MCP registry src/api/routes/mcp.ts — what tools/call can actually dispatch
//   4. grouped catalog     src/api/mcp/catalog.ts — the domain-grouped tool registry
//
// This runs in node, not workerd: it reads the repo's own source off disk, and workerd
// has no node:fs. See the `projects` block in root vite.config.ts.

import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import * as ts from 'typescript/unstable/ast'
import { createVirtualFileSystem } from 'typescript/unstable/fs'
import { API } from 'typescript/unstable/sync'
import { describe, expect, it } from 'vite-plus/test'

import { TOOL_DOMAINS } from '../mcp/catalog'
import { coreMCPTools } from '../routes/mcp'

const SRC = join(import.meta.dirname, '..')
const COMMANDS = join(SRC, '..', 'services', 'commands')

// ---------------------------------------------------------------------------
// Deliberate exceptions.
//
// Note what is NOT here: internal helpers. A service function referenced by neither
// src/mcp nor src/routes is internal *by construction*, so it needs no entry — which is
// why this list stays short as the codebase grows. Only an operation deliberately
// exposed on one surface but not the other has to be named, and every name carries its
// reason. A stale entry (one that no longer applies) fails the test too, so the list
// shrinks when a gap is closed instead of quietly rotting.
// ---------------------------------------------------------------------------

/** MCP tools with no REST equivalent. Each is a real parity gap, tracked in PROJ-633. */
const MCP_ONLY: Record<string, string> = {
  'projects.ts:listProjects':
    'workspace-scoped list; the REST surface serves the cross-workspace listProjectsAcrossWorkspaces instead',
}

/**
 * REST operations with no MCP tool. Browser-only by design unless noted — auth, upload
 * plumbing, and public ingest have no agent-facing meaning.
 */
const REST_ONLY: Record<string, string> = {
  // Auth / token plumbing — an agent authenticates, it does not mint credentials.
  'user-tokens.ts:getUserWorkspaces': 'session bootstrap for the browser',
  'user-tokens.ts:createUserToken': 'personal access tokens are minted by a human in the UI',
  'user-tokens.ts:deleteUserToken': "revoking a human's own PAT is a UI action",
  'workspaces.ts:createToken': 'workspace API tokens are minted by a human in the UI',
  'workspaces.ts:listTokens': 'token inventory is a human audit view',
  'workspaces.ts:revokeToken': 'revoking a workspace token is a human action',
  'workspaces.ts:getWorkspaceMcpInfo': 'connection instructions for a human setting up a client',
  // Public share links — issued by a human, consumed anonymously.
  'share.ts:createShareToken': 'public share links are issued by a human',
  'share.ts:getSharedIssue': 'anonymous read path, no workspace auth',
  'share.ts:getSharedLogo': 'streams bytes for the browser, no JSON operation',
  'share.ts:revokeShareToken': 'revoking a public share link is a human action',
  // Upload plumbing — multipart/quota mechanics, not operations.
  'files.ts:uploadStoredAttachment': 'binary multipart upload and R2 I/O remain HTTP-only, not a JSON-RPC contract',
  'files.ts:getStoredAttachment': 'binary R2 download remains HTTP-only, not a JSON-RPC contract',
  'files.ts:deleteStoredAttachment': 'R2 I/O wrapper; its metadata deletion operation is exposed on both surfaces',
  'files.ts:storageQuotaBytes': 'quota arithmetic used by the upload route',
  'files.ts:assertUploadAllowed': 'upload precondition check',
  'files.ts:recordUpload': 'second half of the multipart upload handshake',
  'files.ts:getAttachmentForDownload':
    'streams bytes for the browser; the metadata-shaped read is getAttachment, on both surfaces',
  // Feedback: public ingest is anonymous, triage is a human review queue.
  'feedback.ts:hashFeedbackToken': 'ingest token hashing',
  'feedback.ts:submitFeedback': 'anonymous public ingest, no workspace auth',
  'feedback.ts:bulkMarkReviewed': 'human triage action (PROJ-634)',
  'feedback.ts:bulkConvertToIssue': 'human triage action (PROJ-634)',
  'feedback.ts:getFeedbackSummary': 'human triage dashboard (PROJ-634)',
  // Bootstrap seeds — called by GET /bootstrap in index.ts to populate a new workspace's
  // defaults. Not operations a client invokes; they only run as part of provisioning.
  'custom-fields.ts:seedDefaultCustomFields': 'bootstrap seed for a new workspace',
  'task-statuses.ts:seedDefaultTaskStatuses': 'bootstrap seed for a new workspace',
  'task-types.ts:seedDefaultTaskTypes': 'bootstrap seed for a new workspace',
  // OAuth consent (PROJ-656) — the browser-only half of the connector flow. An agent
  // is the *subject* of these, never the caller: it cannot decide who may connect it.
  'oauth.ts:lookupConsentWorkspace': 'membership check for the human on the consent screen',
  'oauth.ts:listConnectorGrants': 'settings-only: a connector must not enumerate credentials',
  'oauth.ts:revokeConnectorGrant': 'settings-only: revoking a credential is a browser action',
  // Misc.
  'issues.ts:resolveIssueIdParam': 'URL param coercion, not an operation',
  'projects.ts:getProjectBySlug': 'slug routing for the browser; agents address projects by id',
  'projects.ts:listProjectsAcrossWorkspaces':
    "cross-workspace summary for the browser's project switcher; MCP is scoped to one workspace per endpoint",
  'wiki-export.ts:exportWiki': 'file download response, not a JSON operation',
  'workspaces.ts:uploadWorkspaceLogo': 'second half of the multipart logo-upload handshake',
  'workspaces.ts:deleteWorkspaceLogo': 'browser settings-UI action',
  'workspaces.ts:getWorkspaceLogoObject': 'streams bytes for the browser, no JSON operation',
}

/**
 * Tools whose name deliberately differs from snake_case(serviceFunction). The tool name
 * is the public contract and reads better; the service name is internal.
 */
const TOOL_NAME_ALIASES: Record<string, string> = {
  // PROJ-931: "get_issues" reads better as the public tool name than the derived
  // "get_issues_batch" — the service name spells out the implementation (batched), the
  // tool name is the public contract.
  'issues.ts:getIssuesBatch': 'get_issues',
  'issue-links.ts:createLink': 'create_issue_link',
  'issue-links.ts:deleteLink': 'delete_issue_link',
  'issue-links.ts:listLinksForIssue': 'list_issue_links',
  'wiki.ts:getWikiBacklinks': 'get_backlinks',
  'wiki.ts:listStaleWikiPages': 'list_stale_pages',
  'wiki.ts:purgeExpiredWikiPages': 'purge_wiki_trash',
  'wiki.ts:getWikiTree': 'wiki_tree',
  'workspaces.ts:getWorkspaceWithMembers': 'list_members',
}

// ---------------------------------------------------------------------------
// Source scanning
// ---------------------------------------------------------------------------

function tsFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith('.ts'))
}

/** A directory expands to its .ts files; a file path is taken as-is. */
function expandToFiles(path: string): string[] {
  return path.endsWith('.ts') ? [path] : tsFiles(path).map((f) => join(path, f))
}

function snakeCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

/** Qualified import bindings keep facade names distinct from their canonical domain operations. */
interface SourceModule {
  path: string
  ast: ts.SourceFile
  imports: Map<string, { path: string; name?: string }>
  functions: Map<string, ts.Node>
}

function parseSource(path: string, source: string): ts.SourceFile {
  const configFile = `${path}.parity.json`
  const api = new API({
    fs: createVirtualFileSystem({
      [path]: source,
      [configFile]: JSON.stringify({
        compilerOptions: { target: 'esnext', noLib: true, noResolve: true, types: [] },
        files: [path],
      }),
    }),
  })
  try {
    const ast = api
      .updateSnapshot({ openProjects: [configFile] })
      .getProject(configFile)
      ?.program.getSourceFile(path)
    if (!ast) throw new Error(`Could not parse parity source: ${path}`)
    return ast
  } finally {
    api.close()
  }
}

const modules = new Map<string, SourceModule>()
function sourceModule(path: string, sourceOverride?: string): SourceModule {
  const cached = modules.get(path)
  if (cached) return cached
  const source = sourceOverride ?? readFileSync(path, 'utf8')
  const ast = parseSource(path, source)
  const imports: SourceModule['imports'] = new Map()
  for (const declaration of ast.statements) {
    if (!ts.isImportDeclaration(declaration) && !ts.isExportDeclaration(declaration)) continue
    if (!declaration.moduleSpecifier || !ts.isStringLiteral(declaration.moduleSpecifier)) continue
    const specifier = declaration.moduleSpecifier.text
    const target = specifier.startsWith('#commands/')
      ? join(COMMANDS, `${specifier.slice(10)}.ts`)
      : specifier.startsWith('.')
        ? join(path, '..', `${specifier.replace(/\.ts$/, '')}.ts`)
        : undefined
    if (!target) continue
    const bindings = ts.isImportDeclaration(declaration)
      ? declaration.importClause?.namedBindings
      : declaration.exportClause
    if (bindings && ts.isNamespaceImport(bindings)) imports.set(bindings.name.text, { path: target })
    if (bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) {
      for (const binding of bindings.elements)
        imports.set(binding.name.text, { path: target, name: binding.propertyName?.text ?? binding.name.text })
    }
  }
  const functions = new Map<string, ts.Node>()
  for (const node of ast.statements) {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) functions.set(node.name.text, node.body)
    if (ts.isVariableStatement(node))
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer)
          functions.set(declaration.name.text, declaration.initializer)
      }
  }
  const module = { path, ast, imports, functions }
  modules.set(path, module)
  return module
}

function importedSymbol(module: SourceModule, expression: ts.Node): { path: string; name: string } | undefined {
  if (ts.isIdentifier(expression)) {
    const target = module.imports.get(expression.text)
    if (target?.name) return { path: target.path, name: target.name }
    if (module.functions.has(expression.text)) return { path: module.path, name: expression.text }
  }
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    const target = module.imports.get(expression.expression.text)
    if (target && !target.name) return { path: target.path, name: expression.name.text }
  }
  return undefined
}

const coreMethods = new Map<string, { module: SourceModule; node: ts.Node }>()
for (const path of expandToFiles(join(SRC, '..', 'core', 'api')).filter((path) => !path.endsWith('.test.ts'))) {
  const module = sourceModule(path)
  function visit(node: ts.Node): void {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && /^api[A-Z]/.test(node.name.text)) {
      if (coreMethods.has(node.name.text)) throw new Error(`Duplicate named Core operation: ${node.name.text}`)
      coreMethods.set(node.name.text, { module, node: node.initializer })
    }
    node.forEachChild(visit)
  }
  visit(module.ast)
}

interface BinaryContext {
  pathname: string
  method: string
  values: Map<string, unknown>
}
function valueOf(node: ts.Node, context: BinaryContext): unknown {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isIdentifier(node)) return context.values.get(node.text)
  if (ts.isPropertyAccessExpression(node) && node.name.text === 'pathname' && ts.isNewExpression(node.expression))
    return context.pathname
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    if (node.expression.text === 'url' && node.name.text === 'pathname') return context.pathname
    if (node.expression.text === 'request' && node.name.text === 'method') return context.method
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    const value = valueOf(node.operand, context)
    return value === undefined ? undefined : !value
  }
  if (ts.isBinaryExpression(node)) {
    const left = valueOf(node.left, context),
      right = valueOf(node.right, context)
    switch (node.operatorToken.kind) {
      case ts.SyntaxKind.AmpersandAmpersandToken:
        return left === false || right === false
          ? false
          : left === undefined || right === undefined
            ? undefined
            : Boolean(left && right)
      case ts.SyntaxKind.BarBarToken:
        return left === true || right === true
          ? true
          : left === undefined || right === undefined
            ? undefined
            : Boolean(left || right)
      case ts.SyntaxKind.EqualsEqualsEqualsToken:
        return left === undefined || right === undefined ? undefined : left === right
      case ts.SyntaxKind.ExclamationEqualsEqualsToken:
        return left === undefined || right === undefined ? undefined : left !== right
    }
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'exec' &&
    ts.isRegularExpressionLiteral(node.expression.expression)
  ) {
    const text = node.expression.expression.text
    const end = text.lastIndexOf('/')
    const input = node.arguments[0] && valueOf(node.arguments[0], context)
    if (typeof input === 'string') return new RegExp(text.slice(1, end), text.slice(end + 1)).test(input)
  }
  return undefined
}

function pathLiteral(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isTemplateExpression(node)) return `${node.head.text}__value__`
  return undefined
}

/** Trace named functions, native method bindings and only the selected binary request branch. */
function domainOperations(
  module: SourceModule,
  node: ts.Node,
  binary?: BinaryContext,
  visited = new Set<string>(),
): Set<string> {
  const keys = new Set<string>()
  const merge = (items: Iterable<string>) => {
    for (const key of items) keys.add(key)
  }
  function target(path: string, name: string): void {
    const id = `${path}:${name}`
    if (visited.has(id)) return
    if (path.startsWith(`${COMMANDS}/`)) {
      keys.add(`${basename(path)}:${name}`)
      if (!(FILE_IO_WRAPPERS as readonly string[]).includes(name)) return
    } else if (
      !(
        path.startsWith(join(SRC, 'services')) ||
        path.startsWith(join(SRC, '..', 'core', 'api')) ||
        (binary && [join(SRC, '..', 'core', 'files.ts'), join(SRC, '..', 'core', 'shared-logo.ts')].includes(path))
      )
    )
      return
    visited.add(id)
    const implementation = sourceModule(path)
    const body = implementation.functions.get(name)
    if (body) merge(domainOperations(implementation, body, binary, new Set([...visited, id])))
    else {
      const reexport = implementation.imports.get(name)
      if (reexport?.name) target(reexport.path, reexport.name)
    }
  }
  function native(name: string): void {
    const handler = coreMethods.get(name)
    if (handler) merge(domainOperations(handler.module, handler.node, undefined, new Set([...visited, name])))
    else throw new Error(`No concrete Core handler for ${name}`)
  }
  function binaryRequest(pathname: string, method: string): void {
    const worker = sourceModule(join(SRC, '..', 'core', 'worker.ts'))
    function findFetch(child: ts.Node): void {
      if (ts.isPropertyAssignment(child) && ts.isIdentifier(child.name) && child.name.text === 'fetch') {
        merge(
          domainOperations(worker, child.initializer, { pathname: pathname.split('?')[0], method, values: new Map() }),
        )
        return
      }
      child.forEachChild(findFetch)
    }
    findFetch(worker.ast)
  }
  function visit(child: ts.Node, method = binary?.method ?? 'GET'): boolean {
    if (binary && ts.isIfStatement(child)) {
      const condition = valueOf(child.expression, binary)
      if (condition !== undefined)
        return condition
          ? visit(child.thenStatement, method)
          : child.elseStatement
            ? visit(child.elseStatement, method)
            : false
      const thenReturns = visit(child.thenStatement, method)
      const elseReturns = child.elseStatement ? visit(child.elseStatement, method) : false
      return thenReturns && elseReturns
    }
    if (binary && ts.isBlock(child)) {
      for (const statement of child.statements) if (visit(statement, method)) return true
      return false
    }
    if (binary && ts.isTryStatement(child)) return visit(child.tryBlock, method)
    if (binary && ts.isVariableDeclaration(child) && ts.isIdentifier(child.name) && child.initializer)
      binary.values.set(child.name.text, valueOf(child.initializer, binary))
    if (ts.isCallExpression(child)) {
      const expression = child.expression
      const imported = importedSymbol(module, expression)
      if (imported?.name === 'coreFileRequest') {
        const pathname = pathLiteral(child.arguments[1])
        if (!pathname) throw new Error(`Unresolved Core file path in ${module.path}`)
        binaryRequest(pathname, method)
      } else if (ts.isPropertyAccessExpression(expression) && /^api[A-Z]/.test(expression.name.text)) {
        native(expression.name.text)
      } else if (
        ts.isPropertyAccessExpression(expression) &&
        expression.name.text === 'fetch' &&
        ts.isPropertyAccessExpression(expression.expression) &&
        expression.expression.name.text === 'CORE'
      ) {
        const request = child.arguments[0]
        const pathname = request && ts.isNewExpression(request) ? pathLiteral(request.arguments?.[0]) : undefined
        if (!pathname) throw new Error(`Unresolved native fetch address in ${module.path}`)
        binaryRequest(new URL(pathname).pathname, method)
      } else if (imported) target(imported.path, imported.name)
      // Factory arguments bind commands just as calls do: operation(..., agents.registerAgent).
      for (const argument of child.arguments) {
        const reference = importedSymbol(module, argument)
        if (reference) target(reference.path, reference.name)
      }
      if (
        ts.isPropertyAccessExpression(expression) &&
        /^(get|post|put|patch|delete|head|all)$/.test(expression.name.text)
      )
        method = expression.name.text.toUpperCase()
    }
    child.forEachChild((nested) => {
      visit(nested, method)
    })
    return binary !== undefined && ts.isReturnStatement(child)
  }
  visit(node)
  return keys
}

function serviceOperationsUsedIn(...paths: string[]): Set<string> {
  const keys = new Set<string>()
  for (const path of paths.flatMap(expandToFiles).filter((path) => !path.endsWith('.test.ts'))) {
    const module = sourceModule(path)
    for (const statement of module.ast.statements) {
      if (ts.isImportDeclaration(statement) || ts.isFunctionDeclaration(statement)) continue
      for (const key of domainOperations(module, statement)) keys.add(key)
    }
  }
  return keys
}

interface ServiceFn {
  /** `issues.ts:listIssues` — the key used by every exception map above. */
  key: string
  fn: string
  onMcp: boolean
  onRest: boolean
}

// index.ts is part of the REST surface, not just app wiring: it registers eight endpoints
// directly, three of which call service functions (GET/POST /api/workspaces, GET
// /api/projects). Scanning only routes/ made those read as unwired, which is how two
// MCP_ONLY entries came to claim a REST equivalent was missing when one existed, and how
// listAllProjects got swallowed by the internal-by-construction rule. PROJ-638.
/**
 * The concrete R2 wrappers replace route-local I/O, not the metadata contracts.
 * Follow their actual local calls instead of treating an import as the entire path.
 * Only these HTTP I/O entry points are expanded: ordinary domain helpers are not
 * independent surface operations merely because another command calls them.
 */
const FILE_IO_WRAPPERS = ['uploadStoredAttachment', 'getStoredAttachment', 'deleteStoredAttachment'] as const

function fileIoCalls(source: string): Map<string, Set<string>> {
  const ast = parseSource(join(COMMANDS, 'files.ts'), source)
  const calls = new Map<string, Set<string>>()
  for (const node of ast.statements) {
    if (!ts.isFunctionDeclaration(node) || !node.name || !node.body) continue
    const names = new Set<string>()
    function visit(child: ts.Node): void {
      if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) names.add(child.expression.text)
      child.forEachChild(visit)
    }
    visit(node.body)
    calls.set(node.name.text, names)
  }
  return calls
}

const fileWrapperCalls = fileIoCalls(readFileSync(join(COMMANDS, 'files.ts'), 'utf8'))
const restOperations = serviceOperationsUsedIn(join(SRC, 'routes'), join(SRC, 'index.ts'))
const mcpOperations = serviceOperationsUsedIn(join(SRC, 'mcp'))
const toolOperations = new Map<string, Set<string>>()
for (const path of expandToFiles(join(SRC, 'mcp'))) {
  const module = sourceModule(path)
  function visit(node: ts.Node): void {
    if (ts.isObjectLiteralExpression(node)) {
      const name = node.properties.find(
        (property) =>
          ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === 'name',
      )
      const handler = node.properties.find(
        (property) =>
          (ts.isMethodDeclaration(property) || ts.isPropertyAssignment(property)) &&
          ts.isIdentifier(property.name) &&
          property.name.text === 'handler',
      )
      if (name && ts.isPropertyAssignment(name) && ts.isStringLiteral(name.initializer) && handler) {
        if (toolOperations.has(name.initializer.text))
          throw new Error(`Duplicate MCP tool source: ${name.initializer.text}`)
        toolOperations.set(name.initializer.text, domainOperations(module, handler))
      }
    }
    node.forEachChild(visit)
  }
  visit(module.ast)
}
const restIdentifiers = new Set([...restOperations].map((key) => key.split(':')[1]))
const mcpIdentifiers = new Set([...mcpOperations].map((key) => key.split(':')[1]))

const serviceFns: ServiceFn[] = []
for (const path of expandToFiles(COMMANDS)) {
  const file = basename(path)
  const src = readFileSync(path, 'utf8')
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm)) {
    const fn = m[1]
    serviceFns.push({
      key: `${file}:${fn}`,
      fn,
      onMcp: mcpOperations.has(`${file}:${fn}`),
      onRest: restOperations.has(`${file}:${fn}`),
    })
  }
}

const catalogToolNames = TOOL_DOMAINS.flatMap((d) => d.tools.map((t) => t.name))
const runtimeToolNames = coreMCPTools.map((t) => t.name)

// ---------------------------------------------------------------------------

describe('MCP surface parity (PROJ-623)', () => {
  it('traces qualified aliases and namespace facade calls to their actual Core commands', () => {
    const module = sourceModule(
      join(SRC, 'routes', 'parity-alias-fixture.ts'),
      `
      import { getIssue as load } from '../services/issues'
      import * as wiki from '../services/wiki'
      import type { getProject } from '../services/projects'
      // import { getProject as load } from '../services/projects'
      const example = "getProject(ctx, 'project')"
      type Ignored = typeof getProject
      load(ctx, 'issue')
      wiki.getWikiPage(ctx, 'page')
    `,
    )
    expect([...domainOperations(module, module.ast)].sort()).toEqual(['issues.ts:getIssue', 'wiki.ts:getWikiPage'])
  })

  it('follows facade reexports without conflating equal local function names', () => {
    const facade = sourceModule(
      join(SRC, 'services', 'parity-reexport-fixture.ts'),
      `export { getProject as load } from './projects'`,
    )
    const module = sourceModule(
      join(SRC, 'routes', 'parity-reexport-fixture.ts'),
      `
      import { getIssue as load } from '../services/issues'
      import { load as project } from '../services/parity-reexport-fixture'
      load(ctx, 'issue')
      project(ctx, 'project')
    `,
    )
    expect(facade.imports.get('load')?.name).toBe('getProject')
    expect([...domainOperations(module, module.ast)].sort()).toEqual(['issues.ts:getIssue', 'projects.ts:getProject'])
  })

  it('fails closed for an unresolved native named operation', () => {
    const module = sourceModule(join(SRC, 'routes', 'parity-missing-fixture.ts'), `client.apiMissingOperation(actor)`)
    expect(() => domainOperations(module, module.ast)).toThrow('No concrete Core handler for apiMissingOperation')
  })

  it('traces only the selected native binary pathname and HTTP method', () => {
    function operations(method: string, pathname: string) {
      const module = sourceModule(
        join(SRC, 'routes', `parity-binary-${method}-${encodeURIComponent(pathname)}.ts`),
        `
        import { coreFileRequest } from '../http/core-files'
        router.${method}('/surface', (ctx) => coreFileRequest(ctx, '${pathname}'))
      `,
      )
      return domainOperations(module, module.ast)
    }
    expect([...operations('get', '/files/attachment')]).toEqual(['files.ts:getAttachmentForDownload'])
    const upload = operations('post', '/files')
    expect(upload.has('files.ts:uploadStoredAttachment')).toBe(true)
    expect(upload.has('files.ts:recordUpload')).toBe(true)
    expect(upload.has('files.ts:getAttachmentForDownload')).toBe(false)
    expect([...operations('get', '/wiki-export')]).toEqual(['wiki-export.ts:exportWiki'])
    expect([...operations('get', '/unregistered')]).toEqual([])
  })

  it('finds the source it is meant to be checking', () => {
    // Guards against the scanners silently matching nothing — a regex that stops
    // matching would otherwise turn every assertion below into a vacuous pass.
    expect(serviceFns.length).toBeGreaterThan(150)
    expect(restIdentifiers.size).toBeGreaterThan(50)
    expect(mcpIdentifiers.size).toBeGreaterThan(50)
    expect(catalogToolNames.length).toBeGreaterThan(100)
  })

  it('sees the REST surface registered in index.ts, not just routes/', () => {
    // PROJ-638: listProjectsAcrossWorkspaces is wired only by GET /api/projects in
    // index.ts. When the scan covered routes/ alone it read as unwired, so the
    // internal-by-construction rule swallowed it and two MCP_ONLY entries wrongly
    // claimed no REST equivalent existed. Naming a specific index.ts-only identifier
    // makes that regression fail here rather than resurface as a false parity gap.
    expect(restIdentifiers.has('listProjectsAcrossWorkspaces')).toBe(true)
    expect(restIdentifiers.has('createWorkspace')).toBe(true)
  })

  it('traces concrete file I/O wrappers to metadata operations without creating binary MCP contracts', () => {
    expect([...(fileWrapperCalls.get('uploadStoredAttachment') ?? [])].sort()).toEqual([
      'assertEntityWritable',
      'assertUploadAllowed',
      'recordUpload',
    ])
    expect([...(fileWrapperCalls.get('getStoredAttachment') ?? [])]).toEqual(['getAttachmentForDownload'])
    expect([...(fileWrapperCalls.get('deleteStoredAttachment') ?? [])]).toEqual(['deleteAttachment'])
    for (const fn of ['assertUploadAllowed', 'recordUpload', 'getAttachmentForDownload', 'deleteAttachment']) {
      expect(restIdentifiers.has(fn)).toBe(true)
    }
    expect(mcpIdentifiers.has('deleteAttachment')).toBe(true)
    expect(restIdentifiers.has('uploadStoredAttachment')).toBe(true)
    for (const wrapper of ['getStoredAttachment', 'deleteStoredAttachment']) {
      expect(restIdentifiers.has(wrapper)).toBe(false)
    }
    for (const wrapper of FILE_IO_WRAPPERS) expect(mcpIdentifiers.has(wrapper)).toBe(false)
  })

  it('ignores comments, type references and unrelated function bodies when tracing wrapper calls', () => {
    const calls = fileIoCalls(`
      export async function deleteStoredAttachment(ctx: unknown, id: string): Promise<void> {
        // getAttachmentForDownload(ctx, id) is not a call.
        const label = 'recordUpload(ctx, id)'
        await deleteAttachment(ctx, { id })
      }
      function unrelated() { recordUpload() }
    `)
    expect([...(calls.get('deleteStoredAttachment') ?? [])]).toEqual(['deleteAttachment'])
  })

  it('has no service function name exported from two different files', () => {
    // Count only canonical domain exports, not the intentional same-named adapter facades.
    const byName = new Map<string, string[]>()
    for (const { fn, key } of serviceFns) {
      byName.set(fn, [...(byName.get(fn) ?? []), key.split(':')[0]])
    }
    const collisions = [...byName].filter(([, files]) => files.length > 1)
    expect(collisions).toEqual([])
  })

  describe('catalog vs runtime registry', () => {
    it('agrees on membership and order', () => {
      // Not two set comparisons: the arrays must be identical sequences. tools/list
      // returns the runtime order and the docs table renders the catalog order, so
      // reordering one without the other makes the docs lie about dispatch.
      expect(runtimeToolNames).toEqual(catalogToolNames)
    })

    it('resolves every runtime tool handler to an actual domain operation', () => {
      expect([...toolOperations.keys()].sort()).toEqual([...runtimeToolNames].sort())
      expect([...toolOperations].filter(([, operations]) => operations.size === 0).map(([name]) => name)).toEqual([])
    })

    it('has no duplicate tool names', () => {
      const counts = new Map<string, number>()
      for (const name of runtimeToolNames) counts.set(name, (counts.get(name) ?? 0) + 1)
      const dupes = [...counts].filter(([, n]) => n > 1).map(([name]) => name)
      expect(dupes).toEqual([])
    })

    it('classifies every tool into exactly one group', () => {
      const byTool = new Map<string, string[]>()
      for (const domain of TOOL_DOMAINS) {
        for (const tool of domain.tools) {
          byTool.set(tool.name, [...(byTool.get(tool.name) ?? []), domain.group])
        }
      }
      const unclassified = runtimeToolNames.filter((n) => (byTool.get(n) ?? []).length !== 1)
      expect(unclassified).toEqual([])
      for (const groups of byTool.values()) {
        expect(['Coordination', 'Project data']).toContain(groups[0])
      }
    })

    it('gives every tool a description and an object inputSchema', () => {
      const bad = coreMCPTools
        .filter((t) => !t.description?.trim() || (t.inputSchema as { type?: string } | undefined)?.type !== 'object')
        .map((t) => t.name)
      expect(bad).toEqual([])
    })
  })

  describe('service functions vs both surfaces', () => {
    it('exposes every MCP-wired operation over REST too', () => {
      const gaps = serviceFns.filter((s) => s.onMcp && !s.onRest && !(s.key in MCP_ONLY)).map((s) => s.key)
      expect(gaps).toEqual([])
    })

    it('exposes every REST-wired operation as an MCP tool too', () => {
      const gaps = serviceFns.filter((s) => s.onRest && !s.onMcp && !(s.key in REST_ONLY)).map((s) => s.key)
      expect(gaps).toEqual([])
    })

    it("names every MCP-wired operation's tool after its service function", () => {
      const mismatched = serviceFns
        .filter((s) => s.onMcp)
        .filter((s) => {
          const expected = TOOL_NAME_ALIASES[s.key] ?? snakeCase(s.fn)
          return !catalogToolNames.includes(expected) || !toolOperations.get(expected)?.has(s.key)
        })
        .map((s) => `${s.key} -> ${TOOL_NAME_ALIASES[s.key] ?? snakeCase(s.fn)}`)
      expect(mismatched).toEqual([])
    })
  })

  describe('the exception lists stay honest', () => {
    const keys = new Set(serviceFns.map((s) => s.key))

    it('names only service functions that still exist', () => {
      const stale = [...Object.keys(MCP_ONLY), ...Object.keys(REST_ONLY), ...Object.keys(TOOL_NAME_ALIASES)].filter(
        (k) => !keys.has(k),
      )
      expect(stale).toEqual([])
    })

    it('drops entries whose gap has been closed', () => {
      const byKey = new Map(serviceFns.map((s) => [s.key, s]))
      const fixed = [
        ...Object.keys(MCP_ONLY).filter((k) => byKey.get(k)?.onRest),
        ...Object.keys(REST_ONLY).filter((k) => byKey.get(k)?.onMcp),
      ]
      expect(fixed).toEqual([])
    })

    it('states a reason for every entry', () => {
      const empty = [...Object.entries(MCP_ONLY), ...Object.entries(REST_ONLY)]
        .filter(([, reason]) => reason.trim().length < 10)
        .map(([k]) => k)
      expect(empty).toEqual([])
    })

    it('aliases only names that differ from the derived one', () => {
      const redundant = Object.entries(TOOL_NAME_ALIASES)
        .filter(([key, alias]) => snakeCase(key.split(':')[1]) === alias)
        .map(([k]) => k)
      expect(redundant).toEqual([])
    })
  })
})
