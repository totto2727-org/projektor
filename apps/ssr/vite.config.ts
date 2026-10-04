import { effrontCloudflare } from "@effront/cloudflare";
import { effrontTailwind } from "@effront/tailwind";
import { effront } from "@effront/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
	publicDir: "../web/public",
	plugins: [
		effront(),
		effrontCloudflare(
			process.env.EFFRONT_WRANGLER_CONFIG
				? { configPath: process.env.EFFRONT_WRANGLER_CONFIG }
				: undefined
		),
		...effrontTailwind({ stylesheet: "./src/styles/app.css" }),
	],
});
