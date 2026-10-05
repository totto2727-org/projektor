import { effrontAlchemy } from "@effront/alchemy/cloudflare/vite";
import { effrontTailwind } from "@effront/tailwind";
import { effront } from "@effront/vite";
import { defineConfig, type UserConfig } from "vite-plus";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }): UserConfig => ({
	resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
	// Alchemy configures the entry Worker as neutral. The RSC child renderer
	// also runs in workerd, not Node, including Comark's bundled ELK dependency.
	environments: { ssr: { build: { rolldownOptions: { platform: "neutral" } } } },
	plugins:
		mode === "test"
			? []
			: [effront(), effrontAlchemy(), ...effrontTailwind({ stylesheet: "./src/styles/app.css" })],
	test: {
		environment: "node",
		include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
		restoreMocks: true,
	},
}));
