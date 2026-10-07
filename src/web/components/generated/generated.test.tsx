import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { cn } from "../../lib/utils";
import { Badge } from "./badge";
import { Button } from "./button";
import { Card, CardContent, CardHeader, CardTitle } from "./card";
import { Field, FieldError, FieldLabel } from "./field";
import { Input } from "./input";

// Application integration checks, not modifications to official generated primitives.
describe("official Base UI component integration", () => {
	it("retains Base UI button semantics and merges caller classes", () => {
		const html = renderToStaticMarkup(
			<Button disabled className="h-12">
				Save
			</Button>,
		);
		expect(html).toContain('data-slot="button"');
		expect(html).toContain('disabled=""');
		expect(html).toContain("Save");
		expect(html).toContain("h-12");
		expect(cn("h-8", "h-12")).toBe("h-12");
	});

	it("keeps form labels, input naming and field errors available to adapters", () => {
		const html = renderToStaticMarkup(
			<Field>
				<FieldLabel htmlFor="generated-title">Title</FieldLabel>
				<Input id="generated-title" name="title" required aria-invalid />
				<FieldError errors={[{ message: "Title is required" }]} />
			</Field>,
		);
		expect(html).toContain('for="generated-title"');
		expect(html).toContain('name="title"');
		expect(html).toContain('aria-invalid="true"');
		expect(html).toContain('role="alert"');
		expect(html).toContain("Title is required");
	});

	it("renders generated card and badge slots without legacy UI implementations", () => {
		const html = renderToStaticMarkup(
			<Card>
				<CardHeader>
					<CardTitle>Project</CardTitle>
				</CardHeader>
				<CardContent>
					<Badge>Active</Badge>
				</CardContent>
			</Card>,
		);
		for (const slot of ["card", "card-header", "card-title", "card-content", "badge"]) {
			expect(html).toContain(`data-slot="${slot}"`);
		}
	});

	it("keeps official Base UI generation aliases and Tailwind v4 theme integration", () => {
		const config = JSON.parse(
			readFileSync(new URL("../../../../components.json", import.meta.url), "utf8"),
		);
		const css = readFileSync(new URL("../../styles/shadcn.css", import.meta.url), "utf8");
		expect(config.style).toBe("base-nova");
		expect(config.rsc).toBe(true);
		expect(config.aliases.ui).toBe("@/components/generated");
		expect(config.aliases.utils).toBe("@/lib/utils");
		expect(config.tailwind.config).toBe("");
		expect(css).toContain('@import "shadcn/tailwind.css"');
		expect(css).toContain('[data-theme="dark"]');
		expect(css).toContain("--sidebar: var(--nav-bg");
		expect(css).not.toContain("@fontsource-variable/geist");
	});
});
