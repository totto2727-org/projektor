import { Effect, Schema } from "effect";
import { HttpClientResponse } from "effect/unstable/http";
import type React from "react";
import type { RequestApi } from "../../server/api-client";
import { type ApiError, responseError } from "../../server/errors";
import { DEFAULT_BRAND, DeploymentBrand, layerBrand, WorkspaceBrand } from "./brand";
import ShareView, { ErrorState } from "./ShareView";

const nullable = Schema.NullOr(Schema.String);
const SharedIssue = Schema.Struct({
	title: Schema.String,
	body: nullable,
	priority: Schema.String,
	status_name: nullable,
	status_category: nullable,
	project_key: nullable,
	project_name: nullable,
	assignee_name: nullable,
	created_at: Schema.Number,
	expires_at: Schema.Number,
	customFields: Schema.Array(
		Schema.Struct({
			key: Schema.String,
			label: Schema.String,
			type: Schema.String,
			value: Schema.String,
		})
	),
	brand: WorkspaceBrand,
});
const SHARE_STYLES = `
@font-face { font-family: 'Projektor Mono'; src: url('/fonts/MonaspaceNeon-Variable.woff2') format('woff2-variations'); font-weight: 400 700; font-style: normal; font-display: swap; unicode-range: U+0020-007E, U+00A0-00FF, U+0100-017F, U+20AC, U+2000-206F, U+2190-21FF, U+2200-22FF, U+2500-257F, U+2580-259F, U+25A0-25FF, U+2713, U+2715, U+2717; }
.share-page, .share-page *, .share-page *::before, .share-page *::after { box-sizing: border-box; }
.share-page { min-height: 100vh; background: var(--bg); color: var(--text); font-family: 'Projektor Mono', ui-monospace, 'Cascadia Code', 'Fira Code', monospace; line-height: 1.5; -webkit-font-smoothing: antialiased; }
.share-page .page-wrap { width: 100%; max-width: 720px; margin: 0 auto; }
.share-page .badge { display: inline-flex; align-items: center; padding: 0.125rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 500; white-space: nowrap; }
.share-page .prose { line-height: 1.7; }
.share-page .prose h1, .share-page .prose h2, .share-page .prose h3 { margin-top: 1.5em; margin-bottom: 0.5em; font-weight: 700; }
.share-page .prose p { margin: 0.75em 0; }
.share-page .prose ul, .share-page .prose ol { padding-left: 1.5em; margin: 0.5em 0; }
.share-page .prose code { font-family: inherit; font-size: 0.875em; background: var(--code-bg); color: var(--code-color); padding: 0.1em 0.3em; border-radius: 3px; }
.share-page .prose pre { background: var(--code-bg); padding: 1em; border-radius: 6px; overflow-x: auto; }
.share-page .prose pre code { background: none; padding: 0; }
.share-page .prose a { color: var(--accent); }
.share-page .prose table { width: 100%; border-collapse: collapse; }
.share-page .prose .table-scroll { overflow-x: auto; }
.share-page .prose thead { border-bottom: 1px solid var(--border); }
.share-page .prose thead th { font-weight: 600; text-align: left; padding: 0.4em 0.75em; }
.share-page .prose tbody td { padding: 0.4em 0.75em; }
.share-page .prose tbody tr { border-bottom: 1px solid var(--border); }
.share-page .prose tbody tr:last-child { border-bottom: none; }
.share-page .prose blockquote { border-left: 3px solid var(--border); margin: 0.75em 0; padding: 0.25em 1em; color: var(--text-muted); }
`;

/** Token-authorized public view. Never requests a protected workspace/session lookup. */
export function renderShare(
	api: RequestApi,
	_scope: null,
	url: URL,
	params: Readonly<Record<string, string | undefined>> = {}
): Effect.Effect<React.ReactElement, ApiError> {
	return Effect.gen(function* () {
		const shareToken = params.token ?? url.searchParams.get("token");
		if (!shareToken) return <ErrorState error="not_found" />;
		const { issue, base } = yield* Effect.all(
			{
				issue: api.execute(api.get(`/api/share/${encodeURIComponent(shareToken)}`)).pipe(
					Effect.flatMap(HttpClientResponse.schemaBodyJson(SharedIssue)),
					Effect.mapError(responseError),
					Effect.scoped,
					Effect.catchIf(
						(cause) => [404, 410].includes(cause.status),
						() => Effect.succeed(null)
					)
				),
				base: api.execute(api.get("/api/config/brand")).pipe(
					Effect.flatMap(HttpClientResponse.schemaBodyJson(DeploymentBrand)),
					Effect.mapError(responseError),
					Effect.scoped,
					Effect.catchIf(
						(cause) => cause.status === 404,
						() => Effect.succeed(DEFAULT_BRAND)
					)
				),
			},
			{ concurrency: 2 }
		);
		if (!issue) return <ErrorState error="not_found" />;
		const brand = layerBrand(base, issue.brand);
		const style: React.CSSProperties = {
			...(brand.accent
				? {
						"--accent": brand.accent,
						"--light-accent": brand.accent,
						"--dark-accent": brand.accent,
					}
				: {}),
			...(brand.onAccent
				? {
						"--on-accent": brand.onAccent,
						"--light-on-accent": brand.onAccent,
						"--dark-on-accent": brand.onAccent,
					}
				: {}),
			...(brand.fontFamily ? { fontFamily: brand.fontFamily } : {}),
		};
		return (
			<div className="share-page" style={style}>
				<title>{`Shared Issue - ${brand.name}`}</title>
				<meta name="description" content={`Shared issue from ${brand.name}.`} />
				<meta property="og:title" content={`Shared Issue - ${brand.name}`} />
				<meta property="og:description" content={`Shared issue from ${brand.name}.`} />
				<link rel="icon" href={brand.logoUrl ?? "/favicon.svg"} />
				<link rel="apple-touch-icon" href={brand.logoUrl ?? "/icon-192.png"} />
				{brand.fontUrl && <link rel="stylesheet" href={brand.fontUrl} />}
				<style>{SHARE_STYLES}</style>
				<div className="page-wrap">
					<ShareView issue={issue} />
				</div>
			</div>
		);
	});
}
