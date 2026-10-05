import { defineConfig } from "vite-plus";

// Stack execution is owned by Alchemy. Package tasks retain the Astro docs
// application and the API's real Cloudflare Workers test runtime.
const ignorePatterns = [
	"**/node_modules/**",
	"**/dist/**",
	"**/.wrangler/**",
	"**/coverage/**",
	"tmp/**",
	".claude/**",
	"README.md",
	"apps/docs/src/content/docs/philosophy/**",
	"apps/docs/src/generated/**",
	"apps/docs/src/content/docs/agents/tool-catalog.md",
	"apps/docs/src/content/docs/agents/workflow-spec.md",
	"apps/docs/src/content/docs/agents/playbooks/**",
	"apps/docs/src/content/docs/contributing/conventions.md",
	"apps/docs/src/content/docs/guides/feedback-widget-integration.md",
	// Maintained upstream shadcn source is not product-owned formatting/linting.
	"apps/web/src/components/generated/**",
];

// Check maintained runtime code, not the upstream docs or plugin applications.
const ciPaths =
	"apps/api apps/web packages/db packages/data-services packages/types infra alchemy.run.ts";

export default defineConfig({
	run: {
		tasks: {
			ci: {
				command: "",
				dependsOn: ["ci:format", "ci:check", "test:packages"],
				cache: false,
			},
			"ci:format": {
				command: `vp fmt --check ${ciPaths} vite.config.ts .github/workflows`,
				cache: false,
			},
			// One typed lint pass also checks compiler diagnostics. Legacy warning
			// noise is omitted, but errors remain failures. Do not run vp check over
			// the whole repository or duplicate package-level typed lint passes.
			"ci:check": {
				command: `vp lint --type-check --quiet ${ciPaths}`,
				cache: false,
			},
			"dev:stack": { command: "alchemy dev", cache: false },
			// Alchemy has no standalone build command. This task builds only the
			// separately maintained documentation site, never deploys Workers.
			"build:packages": {
				command: "",
				dependsOn: ["@projektor/docs#build"],
				cache: false,
			},
			"check:types": {
				command: "",
				dependsOn: [
					"@projektor/api#type-check",
					"@projektor/web#type-check",
					"@projektor/docs#type-check",
					"@projektor/db#type-check",
					"@projektor/plugin-sdk#type-check",
					"@projektor/types#type-check",
					"@projektor/plugin-github#type-check",
				],
				cache: false,
			},
			"test:packages": {
				command: "",
				dependsOn: [
					"@projektor/api#test",
					"@projektor/web#test",
					"@projektor/db#test",
					"@projektor/data-services#test",
					"test:infra",
				],
				cache: false,
			},
			"test:infra": { command: "vp test run infra/config.test.ts", cache: false },
		},
	},
	fmt: {
		ignorePatterns,
		useTabs: true,
		printWidth: 100,
	},
	lint: {
		plugins: ["eslint", "typescript", "unicorn", "oxc", "react"],
		ignorePatterns,
		options: { typeAware: true, typeCheck: true },
	},
});
