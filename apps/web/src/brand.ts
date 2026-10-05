import { Effect, Schema } from "effect";
import { HttpClientResponse } from "effect/unstable/http";
import type { CSSProperties } from "react";
import type { RequestApi, RequestScope } from "./server";

const NullableString = Schema.NullOr(Schema.String);
const DeploymentBrand = Schema.Struct({
	name: Schema.String,
	mark: Schema.String,
	accent: NullableString,
	onAccent: NullableString,
	logoUrl: NullableString,
});
const WorkspaceBrand = Schema.Struct({
	displayName: NullableString,
	accent: NullableString,
	onAccent: NullableString,
	logoUrl: NullableString,
});

export type BrandConfig = Schema.Schema.Type<typeof DeploymentBrand>;
export const defaultBrand: BrandConfig = {
	name: "Projektor",
	mark: "P",
	accent: null,
	onAccent: null,
	logoUrl: null,
};

/** Cosmetic failures do not turn otherwise valid project data into an error page. */
export function loadBrand(api: RequestApi, scope: RequestScope | null): Effect.Effect<BrandConfig> {
	return Effect.gen(function* () {
		const brand = yield* api.execute(api.get("/api/config/brand")).pipe(
			Effect.flatMap(HttpClientResponse.schemaBodyJson(DeploymentBrand)),
			Effect.scoped,
			Effect.catch(() => Effect.succeed(defaultBrand)),
		);
		if (scope?.selection.kind !== "workspace" && scope?.selection.kind !== "project") return brand;
		const slug = scope.selection.workspace.slug;
		return yield* api
			.execute(
				api.get(`/api/workspaces/${encodeURIComponent(slug)}/brand`, { workspaceSlug: slug }),
			)
			.pipe(
				Effect.flatMap(HttpClientResponse.schemaBodyJson(WorkspaceBrand)),
				Effect.scoped,
				Effect.map((override) => {
					const name = override.displayName ?? brand.name;
					return {
						name,
						mark: override.displayName
							? ([...name.trim()][0]?.toUpperCase() ?? brand.mark)
							: brand.mark,
						accent: override.accent ?? brand.accent,
						onAccent: override.onAccent ?? brand.onAccent,
						logoUrl: override.logoUrl ?? brand.logoUrl,
					};
				}),
				Effect.catch(() => Effect.succeed(brand)),
			);
	});
}

/** Emit preferences before paint without a client-side, cross-workspace brand cache. */
export function brandStyles(brand: BrandConfig): CSSProperties {
	const styles: CSSProperties & Record<string, string> = {};
	if (brand.accent) {
		styles["--light-accent"] = brand.accent;
		styles["--dark-accent"] = brand.accent;
	}
	if (brand.onAccent) {
		styles["--light-on-accent"] = brand.onAccent;
		styles["--dark-on-accent"] = brand.onAccent;
	}
	return styles;
}
