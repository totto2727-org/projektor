import { effrontAlchemy } from "@effront/alchemy/cloudflare/vite";
import { effrontTailwind } from "@effront/tailwind";
import { effront } from "@effront/vite";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import { configDefaults } from "vite-plus/test/config";

const vitePlusRequire = createRequire(import.meta.resolve("vite-plus"));
const ignorePatterns = [
	"**/node_modules/**",
	"**/dist/**",
	"**/.wrangler/**",
	"**/coverage/**",
	"tmp/**",
	".claude/**",
	"README.md",
	"src/web/components/generated/**",
	"tests/e2e-alchemy/.runtime/**",
	"tests/e2e-alchemy/discovery-audited/**",
	"tests/e2e-alchemy/test-results/**",
	"tests/e2e-alchemy/playwright-report/**",
];
const maintained =
	"src alchemy.ts alchemy.run.ts alchemy.test.ts vite.config.ts tests/e2e-alchemy .github/workflows";

// Deterministic test bindings take precedence over any developer .dev.vars.
function testTomlVars(): Record<string, string> {
	const toml = readFileSync(new URL("./wrangler.test.toml", import.meta.url), "utf8");
	const section = toml.split(/^\[/m).find((value) => value.startsWith("vars]"));
	const vars: Record<string, string> = {};
	for (const line of section?.split("\n").slice(1) ?? []) {
		const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*"(.*)"\s*$/);
		if (match) vars[match[1]] = match[2];
	}
	return vars;
}

export default defineConfig(({ mode }) => ({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src/web", import.meta.url)),
			// Cloudflare's native fallback must load the runner used by vp test.
			"vitest/worker": vitePlusRequire.resolve("vitest/worker"),
		},
	},
	// Runtime Markdown's dependencies must not emit Node createRequire shims.
	environments: { ssr: { build: { rolldownOptions: { platform: "neutral" } } } },
	plugins:
		mode === "test"
			? []
			: [
					effront({ application: "./src/web/entry.effront.tsx" }),
					effrontAlchemy({ worker: "./alchemy.ts" }),
					...effrontTailwind({ stylesheet: "./src/web/styles/app.css" }),
				],
	run: {
		tasks: {
			ci: { command: "", dependsOn: ["check:project", "test:project"], cache: false },
			"check:project": { command: "", dependsOn: ["check:format", "check:types"], cache: false },
			"check:format": { command: `vp fmt --check ${maintained}`, cache: false },
			"check:types": { command: `vp lint --type-check --quiet ${maintained}`, cache: false },
			// Cloudflare pool 0.22 supports Vitest 4, while Vite+ 1.1 bundles Vitest 5.
			// Preserve native regressions explicitly until upstream support lands.
			// Real Worker browser acceptance is the separate `just e2e` workflow.
			"test:project": {
				command: "vp test run --project api-node --project web --project data",
				cache: false,
			},
			"test:workers": { command: "vp test run --project workers", cache: false },
			"dev:stack": { command: "alchemy dev --config alchemy.run.ts", cache: false },
		},
	},
	fmt: { ignorePatterns, useTabs: true, printWidth: 100 },
	lint: {
		plugins: ["eslint", "typescript", "unicorn", "oxc", "react"],
		ignorePatterns,
		options: { typeAware: true, typeCheck: true },
	},
	test: {
		projects: [
			{
				plugins: [
					cloudflareTest({
						wrangler: { configPath: "./wrangler.test.toml" },
						miniflare: { bindings: { ...testTomlVars(), DEV_USER_EMAIL: "" } },
					}),
				],
				test: {
					name: "workers",
					include: ["src/api/**/*.test.ts"],
					exclude: [...configDefaults.exclude, "src/api/**/*.node.test.ts"],
					setupFiles: ["./src/api/test/setup.ts"],
					testTimeout: 30_000,
					hookTimeout: 30_000,
				},
			},
			{ test: { name: "api-node", environment: "node", include: ["src/api/**/*.node.test.ts"] } },
			{
				test: {
					name: "web",
					environment: "node",
					include: ["src/web/**/*.test.ts", "src/web/**/*.test.tsx"],
					restoreMocks: true,
				},
			},
			{
				test: {
					name: "data",
					environment: "node",
					include: ["src/db/**/*.test.ts", "src/services/tests/*.test.ts", "alchemy.test.ts"],
				},
			},
		],
		// Expected MCP domain failures are caught at the API boundary. Preserve
		// the existing narrow workerd rejection filter, never arbitrary errors.
		onUnhandledError(error) {
			const kind = "kind" in error ? error.kind : undefined;
			if (
				typeof kind === "string" &&
				["validation", "not_found", "forbidden", "conflict"].includes(kind)
			)
				return false;
		},
	},
}));
