import { Layer } from "effect";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";

/** Configuration only. The application and Worker execution endpoints provide this Layer. */
export const HttpClientLive = Layer.mergeAll(
	FetchHttpClient.layer,
	Layer.succeed(FetchHttpClient.RequestInit, {
		redirect: "manual",
		cache: "no-store",
		credentials: "omit",
	}),
	Layer.succeed(HttpClient.TracerDisabledWhen, () => true)
);
