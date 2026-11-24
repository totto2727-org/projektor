import { Effect, Schema } from 'effect'

import { brandStyles, loadBrand } from './brand.ts'
import { Shell } from './components/shell.tsx'
import { EFFRONT } from './effront.ts'
import { renderFeedback, renderFeedbackDetail } from './features/feedback/server.tsx'
import { renderEpics, renderIssue, renderIssues, renderMyIssues } from './features/issues/server.tsx'
import { renderMetrics, renderSprints } from './features/planning/server.tsx'
import { renderHelp, renderOverview, renderProjects } from './features/projects/server.tsx'
import { renderGroups, renderTokens } from './features/settings/server.tsx'
import { renderShare } from './features/share/server.tsx'
import { renderWiki } from './features/wiki/server.tsx'
import { pageRenderer } from './page.tsx'
import { RequestServices, RequestServicesLive } from './request.ts'

// Safe-ls: only cosmetic preferences, synchronously applied before the stylesheet can paint.
// No tenant or identity data is kept in localStorage and no router lifecycle is installed.
const cosmeticPrefs = `(function(){try{var p=JSON.parse(localStorage.getItem('prefs')||'null')||{},t=p.theme||localStorage.getItem('theme'),r=document.documentElement;if(t==='light'||t==='dark')r.dataset.theme=t;else r.removeAttribute('data-theme');r.dataset.density=p.density==='compact'?'compact':'comfortable';r.dataset.sidebar=p.sidebar==='collapsed'?'collapsed':'expanded'}catch(e){}})();`

const pageTitle = function pageTitle(pathname: string): string {
  const path = pathname.replace(/\/$/u, '') || '/'
  const titles: Record<string, string> = {
    '/': 'Projects',
    '/epics': 'Epics',
    '/feedback': 'Feedback',
    '/help': 'Help',
    '/issues': 'Issues',
    '/issues/view': 'Issue',
    '/metrics': 'Metrics',
    '/my-issues': 'My Issues',
    '/settings/groups': 'Groups',
    '/settings/tokens': 'Connect Agent',
    '/sprints': 'Sprints',
    '/wiki': 'Wiki',
    '/wiki/view': 'Wiki',
  }
  return `${titles[path] ?? (path.startsWith('/projects/view') ? 'Overview' : path.startsWith('/share/') ? 'Shared Issue' : 'Projektor')} · Projektor`
}

const RootLayout = EFFRONT.Layout.make({
  render: ({ children }) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      const publicRoute = /^\/share(?:\/|$)/u.test(services.url.pathname) || /^\/help\/?$/u.test(services.url.pathname)
      const scope = publicRoute ? null : yield* services.scope()
      const brand = yield* loadBrand(services.env, scope, services.request)
      return (
        <html lang='en' style={brandStyles(brand)} suppressHydrationWarning>
          <head>
            <meta charSet='UTF-8' />
            <meta name='viewport' content='width=device-width,initial-scale=1' />
            <meta name='description' content={`${brand.name}, project management for humans and agents.`} />
            <meta name='theme-color' content={brand.accent ?? '#007a87'} media='(prefers-color-scheme: light)' />
            <meta name='theme-color' content={brand.accent ?? '#1fbdcb'} media='(prefers-color-scheme: dark)' />
            <link
              rel='icon'
              type={brand.logoUrl ? undefined : 'image/svg+xml'}
              href={brand.logoUrl ?? '/favicon.svg'}
            />
            <link rel='apple-touch-icon' href={brand.logoUrl ?? '/icon-192.png'} />
            {/* oxlint-disable-next-line rules/no-jsx-script-tag -- Apply stored cosmetic preferences before the first paint and hydration. */}
            <script>{cosmeticPrefs}</script>
            <link
              rel='preload'
              href='/fonts/IBMPlexSans-Variable.woff2'
              as='font'
              type='font/woff2'
              crossOrigin='anonymous'
            />
            <title>{pageTitle(services.url.pathname).replace(/Projektor/gu, brand.name)}</title>
          </head>
          <body>
            <Shell
              scope={scope}
              pathname={services.url.pathname}
              brand={brand}
              returnTo={`${services.url.pathname}${services.url.search}${services.url.hash}`}
            >
              {children}
            </Shell>
          </body>
        </html>
      )
    }),
})

const projects = pageRenderer(renderProjects)
const overview = pageRenderer(renderOverview, { requireProject: true, projectNav: true })
const help = pageRenderer(renderHelp, { public: true })
const issues = pageRenderer(renderIssues, { requireWorkspace: true, projectNav: true })
const issue = pageRenderer(renderIssue, { requireWorkspace: true, projectNav: true })
const myIssues = pageRenderer(renderMyIssues)
const epics = pageRenderer(renderEpics, { requireProject: true, projectNav: true })
const sprints = pageRenderer(renderSprints, { requireProject: true, projectNav: true })
const metrics = pageRenderer(renderMetrics, { requireProject: true, projectNav: true })
const wiki = pageRenderer(renderWiki, { requireWorkspace: true, projectNav: true })
const feedback = pageRenderer(renderFeedback, { requireProject: true, projectNav: true })
const feedbackDetail = pageRenderer(renderFeedbackDetail, {
  requireWorkspace: true,
  projectNav: true,
})
const groups = pageRenderer(renderGroups, { requireWorkspace: true })
const tokens = pageRenderer(renderTokens, { requireWorkspace: true })
const share = pageRenderer(renderShare, { public: true })

const routes = EFFRONT.Routes.make({ layout: RootLayout })
  .mount('/', projects.factory.Routes.make().page('/', projects.factory.Page.make({ render: projects.render })))
  .mount(
    '/',
    overview.factory.Routes.make()
      .page('/projects/view', overview.factory.Page.make({ render: overview.render }))
      .page(
        '/projects/view/:projectSlug',
        overview.factory.Page.make({
          params: Schema.Struct({ projectSlug: Schema.String }),
          render: overview.render,
        }),
      ),
  )
  .mount('/', help.factory.Routes.make().page('/help', help.factory.Page.make({ render: help.render })))
  .mount('/', issues.factory.Routes.make().page('/issues', issues.factory.Page.make({ render: issues.render })))
  .mount(
    '/',
    issue.factory.Routes.make()
      .page('/issues/view', issue.factory.Page.make({ render: issue.render }))
      .page(
        '/projects/:projectSlug/issues/:issueNumber/:titleSlug',
        issue.factory.Page.make({
          params: Schema.Struct({
            projectSlug: Schema.String,
            issueNumber: Schema.String,
            titleSlug: Schema.String,
          }),
          render: issue.render,
        }),
      ),
  )
  .mount(
    '/',
    myIssues.factory.Routes.make().page('/my-issues', myIssues.factory.Page.make({ render: myIssues.render })),
  )
  .mount('/', epics.factory.Routes.make().page('/epics', epics.factory.Page.make({ render: epics.render })))
  .mount('/', sprints.factory.Routes.make().page('/sprints', sprints.factory.Page.make({ render: sprints.render })))
  .mount('/', metrics.factory.Routes.make().page('/metrics', metrics.factory.Page.make({ render: metrics.render })))
  .mount(
    '/',
    wiki.factory.Routes.make()
      .page('/wiki', wiki.factory.Page.make({ render: wiki.render }))
      .page('/wiki/view', wiki.factory.Page.make({ render: wiki.render }))
      .page(
        '/wiki/:slug',
        wiki.factory.Page.make({
          params: Schema.Struct({ slug: Schema.String }),
          render: wiki.render,
        }),
      ),
  )
  .mount('/', feedback.factory.Routes.make().page('/feedback', feedback.factory.Page.make({ render: feedback.render })))
  .mount(
    '/',
    feedbackDetail.factory.Routes.make()
      .page('/feedback/view', feedbackDetail.factory.Page.make({ render: feedbackDetail.render }))
      .page(
        '/feedback/:sourceId',
        feedbackDetail.factory.Page.make({
          params: Schema.Struct({ sourceId: Schema.String }),
          render: feedbackDetail.render,
        }),
      ),
  )
  .mount(
    '/',
    groups.factory.Routes.make().page('/settings/groups', groups.factory.Page.make({ render: groups.render })),
  )
  .mount(
    '/',
    tokens.factory.Routes.make().page('/settings/tokens', tokens.factory.Page.make({ render: tokens.render })),
  )
  .mount(
    '/',
    share.factory.Routes.make()
      .page('/share/view', share.factory.Page.make({ render: share.render }))
      .page(
        '/share/:token',
        share.factory.Page.make({
          params: Schema.Struct({ token: Schema.String }),
          render: share.render,
        }),
      ),
  )

// oxlint-disable-next-line import/no-default-export -- Effront loads the application from the configured module default export.
export default EFFRONT.make({
  routes,
  layer: RequestServicesLive,
})
