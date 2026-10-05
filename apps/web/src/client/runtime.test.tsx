// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { RuntimeProvider, useRuntime } from "./runtime";

function CurrentPage() {
	const { url } = useRuntime();
	return <output>{url}</output>;
}

describe("server-supplied display context", () => {
	it("uses the current SSR page props without retaining a previous route", () => {
		const { rerender } = render(
			<RuntimeProvider scope={null} url="https://app.test/issues">
				<CurrentPage />
			</RuntimeProvider>,
		);
		expect(screen.getByText("https://app.test/issues")).toBeTruthy();
		rerender(
			<RuntimeProvider scope={null} url="https://app.test/wiki">
				<CurrentPage />
			</RuntimeProvider>,
		);
		expect(screen.getByText("https://app.test/wiki")).toBeTruthy();
		expect(screen.queryByText("https://app.test/issues")).toBeNull();
	});
});
