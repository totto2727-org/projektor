import { Layer } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";

/** Tests provide their transport at the test execution boundary, never inside domain code. */
export const TestHttpClient = Layer.mergeAll(
	FetchHttpClient.layer,
	Layer.succeed(FetchHttpClient.RequestInit, {
		redirect: "manual",
		cache: "no-store",
		credentials: "omit",
	}),
	Layer.succeed(HttpClient.TracerDisabledWhen, () => true),
);
