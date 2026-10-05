import { fileURLToPath } from "node:url";
import cloudflare from "@alchemy.run/cloudflare-runtime/vite";
import { defineConfig } from "vite-plus";
import { apiWorkerOptions } from "./api-host";

// Build the unchanged API adapter with the official host. Preview is owned by
// the single frontend runtime, whose public extension adds the API service.
export default defineConfig((environment) => {
	if (environment.isPreview) {
		throw new Error(
			"The API artifact must run inside the single E2E frontend preview, not a second SQLite host.",
		);
	}
	return {
		root: fileURLToPath(new URL(".", import.meta.url)),
		publicDir: false,
		plugins: [
			cloudflare({
				main: "./api.worker.ts",
				compatibilityDate: "2026-09-01",
				compatibilityFlags: ["nodejs_compat"],
				worker: apiWorkerOptions,
			}),
		],
	};
});
