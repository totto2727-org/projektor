/*
 * PROJ-623: mechanical parity across the four tool surfaces.
 *
 * Parity used to be held by convention plus two hand-written spot checks in mcp.test.ts
 * (issues and wiki — 2 of 22 domains), and mcp/catalog.ts carried a comment asking a
 * human to keep its order in sync with the runtime registry by hand. This test replaces
 * both with a check that fails the build.
 *
 * The four surfaces:
 *   1. service functions   src/services/commands/*.ts — the operations that exist at all
 *   2. REST routes         src/api/routes/*.ts   — the browser/HTTP surface
 *   3. runtime MCP registry src/api/routes/mcp.ts — what tools/call can actually dispatch
 *   4. grouped catalog     src/api/mcp/catalog.ts — the domain-grouped tool registry
 *
 * This runs in node, not workerd: it reads the repo's own source off disk, and workerd
 * has no node:fs. See the `projects` block in root vite.config.ts.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Iterable, String, Array, Predicate } from 'effect'
import * as ts from 'typescript/unstable/ast'
import { createVirtualFileSystem } from 'typescript/unstable/fs'
import { API } from 'typescript/unstable/sync'
import { assert, describe, expect, test } from 'vite-plus/test'

import { TOOL_DOMAINS } from '#api/mcp/catalog.ts'
import { coreMCPTools } from '#api/routes/mcp.ts'

const SRC = join(import.meta.dirname, '..')
const COMMANDS = join(SRC, '..', 'services', 'commands')

/*
 * ---------------------------------------------------------------------------
 * Deliberate exceptions.
 *
 * Note what is NOT here: internal helpers. A service function referenced by neither
 * src/mcp nor src/routes is internal *by construction*, so it needs no entry — which is
 * why this list stays short as the codebase grows. Only an operation deliberately
 * exposed on one surface but not the other has to be named, and every name carries its
 * reason. A stale entry (one that no longer applies) fails the test too, so the list
 * shrinks when a gap is closed instead of quietly rotting.
 * ---------------------------------------------------------------------------
 */

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
  /*
   * Bootstrap seeds — called by GET /bootstrap in worker.ts to populate a new workspace's
   * defaults. Not operations a client invokes; they only run as part of provisioning.
   */
  'custom-fields.ts:seedDefaultCustomFields': 'bootstrap seed for a new workspace',
  'task-statuses.ts:seedDefaultTaskStatuses': 'bootstrap seed for a new workspace',
  'task-types.ts:seedDefaultTaskTypes': 'bootstrap seed for a new workspace',
  /*
   * OAuth consent (PROJ-656) — the browser-only half of the connector flow. An agent
   * is the *subject* of these, never the caller: it cannot decide who may connect it.
   */
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
  /*
   * PROJ-931: "get_issues" reads better as the public tool name than the derived
   * "get_issues_batch" — the service name spells out the implementation (batched), the
   * tool name is the public contract.
   */
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

const tsFiles = function tsFiles(dir: string): string[] {
  return readdirSync(dir).filter((file) => file.endsWith('.ts'))
}

/**
 * A directory expands to its .ts files; a file path is taken as-is.
 *
 * @param {string} path A TypeScript file or its containing directory.
 * @returns {string[]} The source paths to scan for MCP parity.
 */
const expandToFiles = function expandToFiles(path: string): string[] {
  return path.endsWith('.ts') ? [path] : tsFiles(path).map((fileName) => join(path, fileName))
}

const snakeCase = function snakeCase(name: string): string {
  return name.replaceAll(/([a-z0-9])([A-Z])/gu, '$1_$2').toLowerCase()
}

/** Qualified import bindings keep facade names distinct from their canonical domain operations. */
interface SourceModule {
  path: string
  ast: ts.SourceFile
  imports: Map<string, { path: string; name?: string }>
  functions: Map<string, ts.Node>
}

const parseSource = function parseSource(path: string, source: string): ts.SourceFile {
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
    if (!ast) {
      assert.fail(`Could not parse parity source: ${path}`)
    }
    return ast
  } finally {
    api.close()
  }
}

const modules = new Map<string, SourceModule>()
const sourceModule = function sourceModule(path: string, sourceOverride?: string): SourceModule {
  const cached = modules.get(path)
  if (cached) {
    return cached
  }
  const source = sourceOverride ?? readFileSync(path, 'utf8')
  const ast = parseSource(path, source)
  const imports: SourceModule['imports'] = new Map()
  Iterable.forEach(ast.statements, (declaration): void => {
    if (!ts.isImportDeclaration(declaration) && !ts.isExportDeclaration(declaration)) {
      return
    }
    if (!declaration.moduleSpecifier || !ts.isStringLiteral(declaration.moduleSpecifier)) {
      return
    }
    const specifier = declaration.moduleSpecifier.text
    const target = specifier.startsWith('#')
      ? fileURLToPath(import.meta.resolve(specifier))
      : specifier.startsWith('.')
        ? join(path, '..', `${specifier.replace(/\.ts$/u, '')}.ts`)
        : undefined
    if (Predicate.isNullish(target) || String.isEmpty(target)) {
      return
    }
    const bindings = ts.isImportDeclaration(declaration)
      ? declaration.importClause?.namedBindings
      : declaration.exportClause
    if (bindings && ts.isNamespaceImport(bindings)) {
      imports.set(bindings.name.text, { path: target })
    }
    if (bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) {
      Iterable.forEach<ts.ExportSpecifier | ts.ImportSpecifier>(bindings.elements, (binding): void => {
        imports.set(binding.name.text, { path: target, name: binding.propertyName?.text ?? binding.name.text })
      })
    }
  })
  const functions = new Map<string, ts.Node>()
  Iterable.forEach(ast.statements, (node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      functions.set(node.name.text, node.body)
    }
    if (ts.isVariableStatement(node)) {
      Iterable.forEach(node.declarationList.declarations, (declaration): void => {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          functions.set(declaration.name.text, declaration.initializer)
        }
      })
    }
  })
  const module = { path, ast, imports, functions }
  modules.set(path, module)
  return module
}

const importedSymbol = function importedSymbol(
  module: SourceModule,
  expression: ts.Node,
): { path: string; name: string } | undefined {
  if (ts.isIdentifier(expression)) {
    const target = module.imports.get(expression.text)
    if (target?.name) {
      return { path: target.path, name: target.name }
    }
    if (module.functions.has(expression.text)) {
      return { path: module.path, name: expression.text }
    }
  }
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    const target = module.imports.get(expression.expression.text)
    if (target && !target.name) {
      return { path: target.path, name: expression.name.text }
    }
  }
  return undefined
}

const coreMethods = new Map<string, { module: SourceModule; node: ts.Node }>()
const coreMethodName = /^api[A-Z]/u

const recordCoreMethod = function recordCoreMethod(module: SourceModule, name: string, node: ts.Node): void {
  if (coreMethods.has(name)) {
    assert.fail(`Duplicate named Core operation: ${name}`)
  }
  coreMethods.set(name, { module, node })
}

const usesOrderedFields = function usesOrderedFields(module: SourceModule, expression: ts.Node): boolean {
  const factory = importedSymbol(module, expression)
  return factory?.path === join(SRC, '..', 'contracts', 'ordered-fields.ts') && factory.name === 'fieldsInOrder'
}

interface OrderedFieldEntry {
  name: string
  value: ts.Node
}

const orderedFieldEntries = function orderedFieldEntries(
  module: SourceModule,
  call: ts.CallExpression,
): OrderedFieldEntry[] {
  const entries = call.arguments.at(0)
  if (
    !usesOrderedFields(module, call.expression) ||
    Predicate.isNullish(entries) ||
    !ts.isArrayLiteralExpression(entries)
  ) {
    return []
  }
  return entries.elements.flatMap((entry): OrderedFieldEntry[] => {
    if (!ts.isArrayLiteralExpression(entry)) {
      return []
    }
    const name = entry.elements.at(0)
    const value = entry.elements.at(1)
    return Predicate.isNotNullish(name) && ts.isStringLiteral(name) && Predicate.isNotNullish(value)
      ? [{ name: name.text, value }]
      : []
  })
}

Iterable.forEach(
  expandToFiles(join(SRC, '..', 'core', 'api')).filter((path) => !path.endsWith('.test.ts')),
  (path): void => {
    const module = sourceModule(path)
    const visit = function visit(node: ts.Node): void {
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && coreMethodName.test(node.name.text)) {
        recordCoreMethod(module, node.name.text, node.initializer)
      }
      if (ts.isCallExpression(node)) {
        Iterable.forEach(orderedFieldEntries(module, node), ({ name, value }): void => {
          if (coreMethodName.test(name)) {
            recordCoreMethod(module, name, value)
          }
        })
      }
      node.forEachChild(visit)
    }
    visit(module.ast)
  },
)

type BinaryValue = string | boolean | undefined

const isTruthyBinaryValue = (value: BinaryValue): boolean =>
  value === true || (Predicate.isString(value) && String.isNonEmpty(value))

interface BinaryContext {
  pathname: string
  method: string
  values: Map<string, BinaryValue>
}
const valueOf = function valueOf(node: ts.Node, context: BinaryContext): BinaryValue {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }
  if (ts.isIdentifier(node)) {
    return context.values.get(node.text)
  }
  if (ts.isPropertyAccessExpression(node) && node.name.text === 'pathname' && ts.isNewExpression(node.expression)) {
    return context.pathname
  }
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    if (node.expression.text === 'url' && node.name.text === 'pathname') {
      return context.pathname
    }
    if (node.expression.text === 'request' && node.name.text === 'method') {
      return context.method
    }
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    const value = valueOf(node.operand, context)
    return Predicate.isNullish(value) ? undefined : !isTruthyBinaryValue(value)
  }
  if (ts.isBinaryExpression(node)) {
    const left = valueOf(node.left, context),
      right = valueOf(node.right, context)
    switch (node.operatorToken.kind) {
      case ts.SyntaxKind.AmpersandAmpersandToken: {
        if (left === false || right === false) {
          return false
        }
        if (Predicate.isNullish(left) || Predicate.isNullish(right)) {
          return undefined
        }
        return isTruthyBinaryValue(left) && isTruthyBinaryValue(right)
      }
      case ts.SyntaxKind.BarBarToken: {
        if (left === true || right === true) {
          return true
        }
        if (Predicate.isNullish(left) || Predicate.isNullish(right)) {
          return undefined
        }
        return isTruthyBinaryValue(left) || isTruthyBinaryValue(right)
      }
      case ts.SyntaxKind.EqualsEqualsEqualsToken: {
        return Predicate.isNullish(left) || Predicate.isNullish(right) ? undefined : left === right
      }
      case ts.SyntaxKind.ExclamationEqualsEqualsToken: {
        return Predicate.isNullish(left) || Predicate.isNullish(right) ? undefined : left !== right
      }
    }
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'exec' &&
    ts.isRegularExpressionLiteral(node.expression.expression)
  ) {
    const { text } = node.expression.expression
    const end = text.lastIndexOf('/')
    const argument = node.arguments.at(0)
    const input = Predicate.isNotNullish(argument) ? valueOf(argument, context) : undefined
    if (Predicate.isString(input)) {
      return new RegExp(text.slice(1, end), text.slice(end + 1)).test(input)
    }
  }
  return undefined
}

const pathLiteral = function pathLiteral(node: ts.Node | undefined): string | undefined {
  if (!node) {
    return undefined
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }
  if (ts.isTemplateExpression(node)) {
    return `${node.head.text}__value__`
  }
  return undefined
}

/**
 * Trace named functions, native method bindings and only the selected binary request branch.
 *
 * @param {SourceModule} module The parsed module that owns the node.
 * @param {ts.Node} node The function or statement to trace.
 * @param {BinaryContext} binary The optional context that selects the binary request branch.
 * @param {Set<string>} visited The trace targets already visited along this path.
 * @returns {Set<string>} The qualified domain operations reachable from the selected node.
 */
const domainOperations = function domainOperations(
  module: SourceModule,
  node: ts.Node,
  binary?: BinaryContext,
  visited = new Set<string>(),
): Set<string> {
  const keys = new Set<string>()
  const merge = (items: Iterable<string>): void => {
    Iterable.forEach(items, (key): void => {
      keys.add(key)
    })
  }
  const target = function target(path: string, name: string): void {
    const id = `${path}:${name}`
    if (visited.has(id)) {
      return
    }
    if (path.startsWith(`${COMMANDS}/`)) {
      keys.add(`${basename(path)}:${name}`)
      if (!(FILE_IO_WRAPPERS as Readonly<string[]>).includes(name)) {
        return
      }
    } else if (
      !(
        path.startsWith(join(SRC, 'services')) ||
        path.startsWith(join(SRC, '..', 'core', 'api')) ||
        (binary && [join(SRC, '..', 'core', 'files.ts'), join(SRC, '..', 'core', 'shared-logo.ts')].includes(path))
      )
    ) {
      return
    }
    visited.add(id)
    const implementation = sourceModule(path)
    const body = implementation.functions.get(name)
    if (body) {
      merge(domainOperations(implementation, body, binary, new Set([...visited, id])))
    } else {
      const reexport = implementation.imports.get(name)
      if (reexport?.name) {
        target(reexport.path, reexport.name)
      }
    }
  }
  const native = function native(name: string): void {
    const handler = coreMethods.get(name)
    if (handler) {
      merge(domainOperations(handler.module, handler.node, undefined, new Set([...visited, name])))
    } else {
      assert.fail(`No concrete Core handler for ${name}`)
    }
  }
  const binaryRequest = function binaryRequest(pathname: string, method: string): void {
    const worker = sourceModule(join(SRC, '..', 'core', 'worker.ts'))
    const findFetch = function findFetch(child: ts.Node): void {
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
  const visit = function visit(child: ts.Node, method = binary?.method ?? 'GET'): boolean {
    if (binary && ts.isIfStatement(child)) {
      const condition = valueOf(child.expression, binary)
      if (Predicate.isNotNullish(condition)) {
        if (isTruthyBinaryValue(condition)) {
          return visit(child.thenStatement, method)
        }
        if (child.elseStatement) {
          return visit(child.elseStatement, method)
        }
        return false
      }
      const thenReturns = visit(child.thenStatement, method)
      const elseReturns = child.elseStatement ? visit(child.elseStatement, method) : false
      return thenReturns && elseReturns
    }
    if (binary && ts.isBlock(child)) {
      for (const statement of child.statements) {
        if (visit(statement, method)) {
          return true
        }
      }
      return false
    }
    if (binary && ts.isTryStatement(child)) {
      return visit(child.tryBlock, method)
    }
    if (binary && ts.isVariableDeclaration(child) && ts.isIdentifier(child.name) && child.initializer) {
      binary.values.set(child.name.text, valueOf(child.initializer, binary))
    }
    if (ts.isCallExpression(child)) {
      const { expression } = child
      const imported = importedSymbol(module, expression)
      if (imported?.name === 'coreFileRequest') {
        const pathname = pathLiteral(child.arguments[1])
        if (Predicate.isNullish(pathname) || String.isEmpty(pathname)) {
          assert.fail(`Unresolved Core file path in ${module.path}`)
        }
        binaryRequest(pathname, method)
      } else if (ts.isPropertyAccessExpression(expression) && coreMethodName.test(expression.name.text)) {
        native(expression.name.text)
      } else if (
        ts.isPropertyAccessExpression(expression) &&
        expression.name.text === 'fetch' &&
        ts.isPropertyAccessExpression(expression.expression) &&
        expression.expression.name.text === 'CORE'
      ) {
        const request = child.arguments.at(0)
        const pathname =
          Predicate.isNotNullish(request) && ts.isNewExpression(request)
            ? pathLiteral(request.arguments?.[0])
            : undefined
        if (Predicate.isNullish(pathname) || String.isEmpty(pathname)) {
          assert.fail(`Unresolved native fetch address in ${module.path}`)
        }
        binaryRequest(new URL(pathname).pathname, method)
      } else if (imported) {
        target(imported.path, imported.name)
      }
      // Factory arguments bind commands just as calls do: operation(..., agents.registerAgent).
      Iterable.forEach(child.arguments, (argument): void => {
        const reference = importedSymbol(module, argument)
        if (reference) {
          target(reference.path, reference.name)
        }
      })
      if (
        ts.isPropertyAccessExpression(expression) &&
        /^(?:get|post|put|patch|delete|head|all)$/u.test(expression.name.text)
      ) {
        method = expression.name.text.toUpperCase()
      }
    }
    child.forEachChild((nested) => {
      visit(nested, method)
    })
    return Predicate.isNotNullish(binary) && ts.isReturnStatement(child)
  }
  visit(node)
  return keys
}

const serviceOperationsUsedIn = function serviceOperationsUsedIn(...paths: string[]): Set<string> {
  const keys = new Set<string>()
  Iterable.forEach(
    paths.flatMap((path) => expandToFiles(path)).filter((path) => !path.endsWith('.test.ts')),
    (path): void => {
      const module = sourceModule(path)
      for (const statement of module.ast.statements) {
        if (
          ts.isImportDeclaration(statement) ||
          (isFunctionStatement(statement) && Array.isArrayNonEmpty(declaredFunctions(statement)))
        ) {
          continue
        }
        Iterable.forEach(domainOperations(module, statement), (key): void => {
          keys.add(key)
        })
      }
    },
  )
  return keys
}

const isFunctionStatement = (statement: ts.Statement): statement is ts.FunctionDeclaration | ts.VariableStatement =>
  ts.isFunctionDeclaration(statement) || ts.isVariableStatement(statement)

const declaredFunctions = function declaredFunctions(
  statement: ts.FunctionDeclaration | ts.VariableStatement,
): { name: string; body: ts.Node }[] {
  if (ts.isFunctionDeclaration(statement)) {
    return statement.name && statement.body ? [{ body: statement.body, name: statement.name.text }] : []
  }
  return statement.declarationList.declarations.flatMap(({ name, initializer }) =>
    ts.isIdentifier(name) && initializer && ts.isFunctionExpression(initializer) && initializer.name?.text === name.text
      ? [{ body: initializer.body, name: name.text }]
      : [],
  )
}

interface ServiceFn {
  /** `issues.ts:listIssues` — the key used by every exception map above. */
  key: string
  fn: string
  onMcp: boolean
  onRest: boolean
}

/*
 * The API Worker registers eight REST endpoints directly.
 * Three call service functions for GET and POST /api/workspaces and GET /api/projects.
 * Scanning only routes/ made those read as unwired, which is how two
 * MCP_ONLY entries came to claim a REST equivalent was missing when one existed, and how
 * listAllProjects got swallowed by the internal-by-construction rule. PROJ-638.
 */
/**
 * The concrete R2 wrappers replace route-local I/O, not the metadata contracts.
 * Follow their actual local calls instead of treating an import as the entire path.
 * Only these HTTP I/O entry points are expanded: ordinary domain helpers are not
 * independent surface operations merely because another command calls them.
 */
const FILE_IO_WRAPPERS = ['uploadStoredAttachment', 'getStoredAttachment', 'deleteStoredAttachment'] as const

const fileIoCalls = function fileIoCalls(module: SourceModule): Map<string, Set<string>> {
  const calls = new Map<string, Set<string>>()
  const functions = module.ast.statements
    .filter(isFunctionStatement)
    .flatMap((statement) => declaredFunctions(statement))
  Iterable.forEach(functions, (fn): void => {
    const names = new Set<string>()
    const visit = function visit(child: ts.Node): void {
      if (
        ts.isCallExpression(child) &&
        ts.isIdentifier(child.expression) &&
        !usesOrderedFields(module, child.expression)
      ) {
        names.add(child.expression.text)
      }
      child.forEachChild(visit)
    }
    visit(fn.body)
    calls.set(fn.name, names)
  })
  return calls
}

const fileWrapperCalls = fileIoCalls(sourceModule(join(COMMANDS, 'files.ts')))
const restOperations = serviceOperationsUsedIn(join(SRC, 'routes'), join(SRC, 'worker.ts'))
const mcpOperations = serviceOperationsUsedIn(join(SRC, 'mcp'))
const sourceToolName = function sourceToolName(
  module: SourceModule,
  node: ts.ObjectLiteralExpression,
): string | undefined {
  const names = node.properties.flatMap((property): ts.Node[] => {
    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === 'name') {
      return [property.initializer]
    }
    if (ts.isSpreadAssignment(property) && ts.isCallExpression(property.expression)) {
      return orderedFieldEntries(module, property.expression)
        .filter(({ name }) => name === 'name')
        .map(({ value }) => value)
    }
    return []
  })
  const name = names.at(-1)
  return Predicate.isNotNullish(name) && ts.isStringLiteral(name) ? name.text : undefined
}

const toolOperations = new Map<string, Set<string>>()
Iterable.forEach(expandToFiles(join(SRC, 'mcp')), (path): void => {
  const module = sourceModule(path)
  const visit = function visit(node: ts.Node): void {
    if (ts.isObjectLiteralExpression(node)) {
      const name = sourceToolName(module, node)
      const handler = node.properties.find(
        (property) =>
          (ts.isMethodDeclaration(property) || ts.isPropertyAssignment(property)) &&
          ts.isIdentifier(property.name) &&
          property.name.text === 'handler',
      )
      if (Predicate.isNotNullish(name) && Predicate.isNotNullish(handler)) {
        if (toolOperations.has(name)) {
          assert.fail(`Duplicate MCP tool source: ${name}`)
        }
        toolOperations.set(name, domainOperations(module, handler))
      }
    }
    node.forEachChild(visit)
  }
  visit(module.ast)
})
const restIdentifiers = new Set([...restOperations].map((key) => key.split(':')[1]))
const mcpIdentifiers = new Set([...mcpOperations].map((key) => key.split(':')[1]))

const serviceFns: ServiceFn[] = []
Iterable.forEach(expandToFiles(COMMANDS), (path): void => {
  const file = basename(path)
  const exportedFunctions = sourceModule(path)
    .ast.statements.filter(isFunctionStatement)
    .filter((statement) => statement.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword) === true)
    .flatMap((statement) => declaredFunctions(statement))
  Iterable.forEach(exportedFunctions, ({ name: fn }): void => {
    serviceFns.push({
      key: `${file}:${fn}`,
      fn,
      onMcp: mcpOperations.has(`${file}:${fn}`),
      onRest: restOperations.has(`${file}:${fn}`),
    })
  })
})

const catalogToolNames = TOOL_DOMAINS.flatMap((domain) => domain.tools.map((tool) => tool.name))
const runtimeToolNames = coreMCPTools.map((tool) => tool.name)

// ---------------------------------------------------------------------------

describe('covers MCP surface parity (PROJ-623)', () => {
  test('traces qualified aliases and namespace facade calls to their actual Core commands', () => {
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
    expect([...domainOperations(module, module.ast)].toSorted()).toStrictEqual([
      'issues.ts:getIssue',
      'wiki.ts:getWikiPage',
    ])
  })

  test('follows facade reexports without conflating equal local function names', () => {
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
    expect([...domainOperations(module, module.ast)].toSorted()).toStrictEqual([
      'issues.ts:getIssue',
      'projects.ts:getProject',
    ])
  })

  test('fails closed for an unresolved native named operation', () => {
    const module = sourceModule(join(SRC, 'routes', 'parity-missing-fixture.ts'), `client.apiMissingOperation(actor)`)
    expect(() => domainOperations(module, module.ast)).toThrow('No concrete Core handler for apiMissingOperation')
  })

  test('traces only the selected native binary pathname and HTTP method', () => {
    const operations = function operations(method: string, pathname: string): Set<string> {
      const module = sourceModule(
        join(SRC, 'routes', `parity-binary-${method}-${encodeURIComponent(pathname)}.ts`),
        `
        import { coreFileRequest } from '../http/core-files'
        router.${method}('/surface', (ctx) => coreFileRequest(ctx, '${pathname}'))
      `,
      )
      return domainOperations(module, module.ast)
    }
    expect([...operations('get', '/files/attachment')]).toStrictEqual(['files.ts:getAttachmentForDownload'])
    const upload = operations('post', '/files')
    expect(upload.has('files.ts:uploadStoredAttachment')).toBe(true)
    expect(upload.has('files.ts:recordUpload')).toBe(true)
    expect(upload.has('files.ts:getAttachmentForDownload')).toBe(false)
    expect([...operations('get', '/wiki-export')]).toStrictEqual(['wiki-export.ts:exportWiki'])
    expect([...operations('get', '/unregistered')]).toStrictEqual([])
  })

  test('finds the source it is meant to be checking', () => {
    /*
     * Guard against the scanners silently matching nothing.
     */
    expect(serviceFns.length).toBeGreaterThan(150)
    expect(restIdentifiers.size).toBeGreaterThan(50)
    expect(mcpIdentifiers.size).toBeGreaterThan(50)
    expect(catalogToolNames.length).toBeGreaterThan(100)
  })

  test('sees the REST surface registered in worker.ts, not just routes/', () => {
    /*
     * PROJ-638: listProjectsAcrossWorkspaces is wired only by GET /api/projects in
     * worker.ts. When the scan covered routes/ alone it read as unwired, so the
     * internal-by-construction rule swallowed it and two MCP_ONLY entries wrongly
     * claimed no REST equivalent existed. Naming a specific worker.ts-only identifier
     * makes that regression fail here rather than resurface as a false parity gap.
     */
    expect(restIdentifiers.has('listProjectsAcrossWorkspaces')).toBe(true)
    expect(restIdentifiers.has('createWorkspace')).toBe(true)
  })

  test('traces concrete file I/O wrappers to metadata operations without creating binary MCP contracts', () => {
    expect.hasAssertions()
    expect([...(fileWrapperCalls.get('uploadStoredAttachment') ?? [])].toSorted()).toStrictEqual([
      'assertEntityWritable',
      'assertUploadAllowed',
      'recordUpload',
    ])
    expect([...(fileWrapperCalls.get('getStoredAttachment') ?? [])]).toStrictEqual(['getAttachmentForDownload'])
    expect([...(fileWrapperCalls.get('deleteStoredAttachment') ?? [])]).toStrictEqual(['deleteAttachment'])
    Iterable.forEach(
      ['assertUploadAllowed', 'recordUpload', 'getAttachmentForDownload', 'deleteAttachment'],
      (fn): void => {
        expect(restIdentifiers.has(fn)).toBe(true)
      },
    )
    expect(mcpIdentifiers.has('deleteAttachment')).toBe(true)
    expect(restIdentifiers.has('uploadStoredAttachment')).toBe(true)
    Iterable.forEach(['getStoredAttachment', 'deleteStoredAttachment'], (wrapper): void => {
      expect(restIdentifiers.has(wrapper)).toBe(false)
    })
    Iterable.forEach(FILE_IO_WRAPPERS, (wrapper): void => {
      expect(mcpIdentifiers.has(wrapper)).toBe(false)
    })
  })

  test('ignores comments, type references and unrelated function bodies when tracing wrapper calls', () => {
    const calls = fileIoCalls(
      sourceModule(
        join(COMMANDS, 'parity-wrappers-fixture.ts'),
        `
      export async function deleteStoredAttachment(ctx: unknown, id: string): Promise<void> {
        // getAttachmentForDownload(ctx, id) is not a call.
        const label = 'recordUpload(ctx, id)'
        await deleteAttachment(ctx, { id })
      }
      function unrelated() { recordUpload() }
    `,
      ),
    )
    expect([...(calls.get('deleteStoredAttachment') ?? [])]).toStrictEqual(['deleteAttachment'])
  })

  test('has no service function name exported from two different files', () => {
    // Count only canonical domain exports, not the intentional same-named adapter facades.
    const byName = new Map<string, string[]>()
    Iterable.forEach(serviceFns, ({ fn, key }): void => {
      byName.set(fn, [...(byName.get(fn) ?? []), key.split(':')[0]])
    })
    const collisions = [...byName].filter(([, files]) => files.length > 1)
    expect(collisions).toStrictEqual([])
  })

  describe('catalog vs runtime registry', () => {
    test('agrees on membership and order', () => {
      /*
       * Not two set comparisons: the arrays must be identical sequences. tools/list
       * returns the runtime order and the docs table renders the catalog order, so
       * reordering one without the other makes the docs lie about dispatch.
       */
      expect(runtimeToolNames).toStrictEqual(catalogToolNames)
    })

    test('resolves every runtime tool handler to an actual domain operation', () => {
      expect([...toolOperations.keys()].toSorted()).toStrictEqual([...runtimeToolNames].toSorted())
      expect([...toolOperations].filter(([, operations]) => operations.size === 0).map(([name]) => name)).toStrictEqual(
        [],
      )
    })

    test('has no duplicate tool names', () => {
      const counts = new Map<string, number>()
      Iterable.forEach(runtimeToolNames, (name): void => {
        counts.set(name, (counts.get(name) ?? 0) + 1)
      })
      const dupes = [...counts].filter(([, count]) => count > 1).map(([name]) => name)
      expect(dupes).toStrictEqual([])
    })

    test('classifies every tool into exactly one group', () => {
      expect.hasAssertions()
      const byTool = new Map<string, string[]>()
      Iterable.forEach(TOOL_DOMAINS, (domain): void => {
        Iterable.forEach(domain.tools, (tool): void => {
          byTool.set(tool.name, [...(byTool.get(tool.name) ?? []), domain.group])
        })
      })
      const unclassified = runtimeToolNames.filter((toolName) => (byTool.get(toolName) ?? []).length !== 1)
      expect(unclassified).toStrictEqual([])
      Iterable.forEach(byTool.values(), (groups): void => {
        expect(['Coordination', 'Project data']).toContain(groups[0])
      })
    })

    test('gives every tool a description and an object inputSchema', () => {
      const bad = coreMCPTools
        .filter(
          (tool) => !tool.description?.trim() || (tool.inputSchema as { type?: string } | undefined)?.type !== 'object',
        )
        .map((tool) => tool.name)
      expect(bad).toStrictEqual([])
    })
  })

  describe('service functions vs both surfaces', () => {
    test('exposes every MCP-wired operation over REST too', () => {
      const gaps = serviceFns
        .filter(
          (serviceFunction) => serviceFunction.onMcp && !serviceFunction.onRest && !(serviceFunction.key in MCP_ONLY),
        )
        .map((serviceFunction) => serviceFunction.key)
      expect(gaps).toStrictEqual([])
    })

    test('exposes every REST-wired operation as an MCP tool too', () => {
      const gaps = serviceFns
        .filter(
          (serviceFunction) => serviceFunction.onRest && !serviceFunction.onMcp && !(serviceFunction.key in REST_ONLY),
        )
        .map((serviceFunction) => serviceFunction.key)
      expect(gaps).toStrictEqual([])
    })

    test("names every MCP-wired operation's tool after its service function", () => {
      const mismatched = serviceFns
        .filter((serviceFunction) => serviceFunction.onMcp)
        .filter((serviceFunction) => {
          const expected = TOOL_NAME_ALIASES[serviceFunction.key] ?? snakeCase(serviceFunction.fn)
          return !catalogToolNames.includes(expected) || toolOperations.get(expected)?.has(serviceFunction.key) !== true
        })
        .map(
          (serviceFunction) =>
            `${serviceFunction.key} -> ${TOOL_NAME_ALIASES[serviceFunction.key] ?? snakeCase(serviceFunction.fn)}`,
        )
      expect(mismatched).toStrictEqual([])
    })
  })

  describe('the exception lists stay honest', () => {
    const keys = new Set(serviceFns.map((serviceFunction) => serviceFunction.key))

    test('names only service functions that still exist', () => {
      const stale = [...Object.keys(MCP_ONLY), ...Object.keys(REST_ONLY), ...Object.keys(TOOL_NAME_ALIASES)].filter(
        (aliasKey) => !keys.has(aliasKey),
      )
      expect(stale).toStrictEqual([])
    })

    test('drops entries whose gap has been closed', () => {
      const byKey = new Map(serviceFns.map((serviceFunction) => [serviceFunction.key, serviceFunction]))
      const fixed = [
        ...Object.keys(MCP_ONLY).filter((key) => byKey.get(key)?.onRest === true),
        ...Object.keys(REST_ONLY).filter((key) => byKey.get(key)?.onMcp === true),
      ]
      expect(fixed).toStrictEqual([])
    })

    test('states a reason for every entry', () => {
      const empty = [...Object.entries(MCP_ONLY), ...Object.entries(REST_ONLY)]
        .filter(([, reason]) => reason.trim().length < 10)
        .map(([routeKey]) => routeKey)
      expect(empty).toStrictEqual([])
    })

    test('aliases only names that differ from the derived one', () => {
      const redundant = Object.entries(TOOL_NAME_ALIASES)
        .filter(([key, alias]) => snakeCase(key.split(':')[1]) === alias)
        .map(([routeKey]) => routeKey)
      expect(redundant).toStrictEqual([])
    })
  })
})
