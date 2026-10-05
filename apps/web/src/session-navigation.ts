import { Effect, Schema, Stream } from "effect";
import { HttpServerRequest, HttpServerResponse, UrlParams } from "effect/unstable/http";
import { ApiError, checkSameOriginMutation } from "./server";

const SessionForm = Schema.Struct({
	action: Schema.Literals(["login", "logout"]),
	redirect_url: Schema.optional(Schema.String),
});

/** Native POST forms bypass Flight and discard the previous identity's JS runtime. */
export function sessionNavigation(request: Request) {
	return Effect.gen(function* () {
		const incoming = HttpServerRequest.fromWeb(request);
		if (incoming.method !== "POST")
			return HttpServerResponse.empty({ status: 405, headers: { allow: "POST" } });
		yield* checkSameOriginMutation(request);
		if (incoming.headers["content-type"]?.split(";", 1)[0] !== "application/x-www-form-urlencoded")
			return yield* new ApiError("request", 400, "A session navigation form is required.");
		// The Web adapter's text/form accessors do not enforce MaxBodySize in rc.116.
		const text = yield* incoming.stream.pipe(
			Stream.mapAccumEffect(
				() => 0,
				(size, chunk) => {
					const next = size + chunk.byteLength;
					return next > 8192
						? Effect.fail(new ApiError("request", 400, "The session navigation form is too large."))
						: Effect.succeed([next, [chunk]] as const);
				},
			),
			Stream.decodeText(),
			Stream.mkString,
			Effect.mapError(() => new ApiError("request", 400, "Invalid session navigation form.")),
		);
		const form = yield* Schema.decodeUnknownEffect(SessionForm)(
			UrlParams.toRecord(UrlParams.fromInput(new URLSearchParams(text))),
		).pipe(Effect.mapError(() => new ApiError("request", 400, "Invalid session navigation form.")));
		let location = "/cdn-cgi/access/logout";
		if (form.action === "login") {
			const origin = new URL(request.url).origin;
			const destination = yield* Effect.try({
				try: () => new URL(form.redirect_url ?? "/", origin),
				catch: () => new ApiError("request", 400, "A local session redirect is required."),
			});
			if (destination.origin !== origin)
				return yield* new ApiError("request", 400, "A local session redirect is required.");
			location = `/auth/login?${new URLSearchParams({ redirect_url: `${destination.pathname}${destination.search}${destination.hash}` })}`;
		}
		return HttpServerResponse.redirect(location, {
			status: 303,
			headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
		});
	});
}
