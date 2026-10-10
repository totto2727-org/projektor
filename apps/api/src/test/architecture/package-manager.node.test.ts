import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

const root = resolve(__dirname, "../../../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Node.js and pnpm workspace policy", () => {
	it("enforces the strict 24-hour release window without bypasses", () => {
		const settings = parseDocument(read("pnpm-workspace.yaml"));
		expect(settings.errors).toEqual([]);
		expect(settings.get("minimumReleaseAge")).toBe(1440);
		expect(settings.get("minimumReleaseAgeStrict")).toBe(true);
		for (const key of [
			"minimumReleaseAgeExclude",
			"trustLockfile",
			"dangerouslyAllowAllBuilds",
			"overrides",
		]) {
			expect(settings.has(key)).toBe(false);
		}
		expect(settings.toJS()).toEqual({
			packages: ["apps/*", "packages/*", "plugins/*"],
			minimumReleaseAge: 1440,
			minimumReleaseAgeStrict: true,
			allowBuilds: {
				esbuild: true,
				lefthook: true,
				sharp: true,
				workerd: true,
			},
		});
	});

	it("uses only the pnpm lockfile and Node-compatible tool entry points", () => {
		const manifest = JSON.parse(read("package.json"));
		expect(manifest.packageManager).toBe("pnpm@11.28.5");
		expect(manifest.engines.node).toBe(">=22.13");
		expect(manifest.engines.bun).toBeUndefined();
		expect(existsSync(resolve(root, "pnpm-lock.yaml"))).toBe(true);
		expect(existsSync(resolve(root, "bun.lock"))).toBe(false);
		expect(existsSync(resolve(root, "bunfig.toml"))).toBe(false);
		for (const path of [
			"package.json",
			"apps/api/package.json",
			"lefthook.yml",
			"scripts/build-release.sh",
			".github/workflows/ci.yml",
			".github/workflows/docs.yml",
			".github/workflows/release.yml",
		]) {
			expect(read(path), path).not.toMatch(/\bbun (?:install|run|x)\b|oven-sh\/setup-bun/);
		}
		expect(read("scripts/build-release.sh")).toContain("pnpm exec wrangler deploy --dry-run");
	});

	it("keeps the generated conventions page synchronized with AGENTS.md", () => {
		const source = read("AGENTS.md").replace(/^# AGENTS\.md\n+/, "");
		expect(read("apps/docs/src/content/docs/contributing/conventions.md")).toContain(source);
	});
});
