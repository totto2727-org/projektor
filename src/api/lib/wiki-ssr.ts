import { String, Predicate } from 'effect'
import type { Context } from 'hono'
import { makeCoreClient } from 'projektor/core-client'

import { authMiddleware } from '#api/middleware/auth.ts'
import { subdomainRoutingEnabled } from '#api/middleware/workspace.ts'
import { apiReply } from '#api/services/reply.ts'
import { ctxFromHono } from '#api/services/types.ts'
import { getWikiPage } from '#api/services/wiki.ts'
import { ApiWorkspace } from '#contracts/api-auth.ts'
import type { HonoEnv } from '#types'

/*
 * PROJ-487 fix-up: server-side redirect + metadata injection for the /wiki catch-all
 * need a workspace-scoped ServiceCtx, but a plain top-level browser navigation carries
 * none of the signals workspaceMiddleware requires (no X-Workspace-Slug header, and
 * subdomain routing is opt-in) — so this deliberately does NOT reuse workspaceMiddleware
 * verbatim. Instead it mirrors its resolution order and adds DEFAULT_WORKSPACE_SLUG as a
 * final fallback (the common case for a single-tenant deployment, matching the
 * PUBLIC_READ_ONLY/provisioning convention elsewhere in this file), and never writes an
 * error response itself — callers treat a null return as "fall back to the plain shell",
 * not an error, since this is a best-effort enhancement over the client-side behavior
 * that already exists.
 */
const resolveWikiWorkspaceContext = async function resolveWikiWorkspaceContext(
  httpContext: Context<HonoEnv>,
): Promise<{ id: string; name: string; slug: string; role: string } | null> {
  const headerSlug = httpContext.req.header('X-Workspace-Slug')
  const routingEnabled = subdomainRoutingEnabled(httpContext.env.WORKSPACE_SUBDOMAIN_ROUTING)
  const subdomainSlug = routingEnabled ? httpContext.req.header('host')?.split('.')[0] : undefined
  const slug = headerSlug ?? subdomainSlug ?? httpContext.env.DEFAULT_WORKSPACE_SLUG
  if (Predicate.isNullish(slug) || String.isEmpty(slug)) {
    return null
  }

  const user = httpContext.get('user') as { id: string } | undefined
  if (!user) {
    return null
  }

  try {
    return await apiReply(
      ApiWorkspace,
      makeCoreClient(httpContext.env.CORE).apiResolveWorkspace(httpContext.get('coreActor'), {
        kind: 'slug',
        value: slug,
      }),
    )
  } catch {
    return null
  }
}

export interface WikiSsrPage {
  title: string
  content: string
  url: string
}

/*
 * Best-effort: authenticates the request and resolves a workspace-scoped wiki page for
 * SSR purposes (redirect target / injected metadata). Returns null on ANY failure to
 * authenticate, resolve a workspace, or find/view the page — callers must fall back to
 * serving the plain static shell rather than erroring the page load, and must never let
 * this leak page existence/content to an unauthenticated caller.
 */
export const resolveWikiPageForSsr = async function resolveWikiPageForSsr(
  httpContext: Context<HonoEnv>,
  slugOrId: string,
): Promise<WikiSsrPage | null> {
  let authenticated = false
  const authResponse = await authMiddleware(httpContext, async () => {
    authenticated = true
  })
  if (authResponse || !authenticated) {
    return null
  }

  const workspace = await resolveWikiWorkspaceContext(httpContext)
  if (!workspace) {
    return null
  }
  httpContext.set('workspace', { id: workspace.id, name: workspace.name, slug: workspace.slug })
  httpContext.set('role', workspace.role)

  try {
    const page = await getWikiPage(ctxFromHono(httpContext), slugOrId)
    return { title: page.title, content: page.content, url: page.url }
  } catch {
    /*
     * NotFoundError / ForbiddenError / anything else — no metadata to inject, no
     * redirect target; the plain shell (or a client-side 404) still works.
     */
    return null
  }
}

const plainTextExcerpt = function plainTextExcerpt(markdown: string, maxLen = 200): string {
  const plain = markdown
    .replaceAll(/```[\s\S]*?```/gu, ' ')
    .replaceAll(/!\[[^\]]*\]\([^)]*\)/gu, ' ')
    .replaceAll(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replaceAll(/\[\[([^\]|]*)(\|[^\]]*)?\]\]/gu, '$1')
    .replaceAll(/[#>*_`~-]/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim()
  return plain.length > maxLen ? `${plain.slice(0, maxLen - 1)}…` : plain
}

class AttrSetter {
  private attr: string
  private value: string
  constructor(attr: string, value: string) {
    this.attr = attr
    this.value = value
  }
  element(el: Element): void {
    el.setAttribute(this.attr, this.value)
  }
}

class TextSetter {
  private value: string
  constructor(value: string) {
    this.value = value
  }
  element(el: Element): void {
    el.setInnerContent(this.value)
  }
}

/*
 * Rewrites <title> and og:title/og:description/og:url on the static wiki shell response
 * with real values for a resolved page. Never throws — a rewrite failure just means the
 * caller serves the unmodified shell.
 */
export const injectWikiMetadata = function injectWikiMetadata(
  response: Response,
  page: WikiSsrPage,
  pageUrl: string,
): Response {
  const description = plainTextExcerpt(page.content)
  return new HTMLRewriter()
    .on('title', new TextSetter(`${page.title} — Projektor Wiki`))
    .on('meta[property="og:title"]', new AttrSetter('content', page.title))
    .on('meta[property="og:description"]', new AttrSetter('content', description))
    .on('meta[property="og:url"]', new AttrSetter('content', pageUrl))
    .transform(response)
}
