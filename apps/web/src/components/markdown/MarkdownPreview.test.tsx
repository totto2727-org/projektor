// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { MarkdownPreview } from "./MarkdownPreview";
import { renderMarkdownDocument, type RenderedMarkdown } from "./render";

vi.mock("./render", () => ({ renderMarkdownDocument: vi.fn() }));
const renderDocument = vi.mocked(renderMarkdownDocument);
const document = (text: string): RenderedMarkdown => ({ html: `<p>${text}</p>`, toc: [] });
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	renderDocument.mockReset();
});

describe("local Comark preview", () => {
	it("renders prepared canonical HTML during SSR without client effects", () => {
		expect(
			renderToStaticMarkup(
				<MarkdownPreview
					content="**Server**"
					initial={{ html: "<p><strong>Server</strong></p>", toc: [] }}
				/>,
			),
		).toContain("<strong>Server</strong>");
		expect(renderDocument).not.toHaveBeenCalled();
	});
	it("adopts updated canonical action props synchronously without re-rendering Markdown", () => {
		const view = render(<MarkdownPreview content="old" initial={document("Before action")} />);
		view.rerender(<MarkdownPreview content="new" initial={document("After action")} />);
		expect(screen.getByText("After action")).toBeTruthy();
		expect(screen.queryByText("Before action")).toBeNull();
		expect(renderDocument).not.toHaveBeenCalled();
	});
	it("debounces rapid edits and ignores superseded async completions", async () => {
		vi.useFakeTimers({
			toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
		});
		let resolveOld!: (document: RenderedMarkdown) => void;
		renderDocument
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveOld = resolve;
					}),
			)
			.mockResolvedValueOnce(document("New preview"));
		const view = render(<MarkdownPreview content="old" />);
		await act(() => vi.advanceTimersByTimeAsync(200));
		view.rerender(<MarkdownPreview content="intermediate" />);
		await act(() => vi.advanceTimersByTimeAsync(100));
		view.rerender(<MarkdownPreview content="new" />);
		await act(() => vi.advanceTimersByTimeAsync(200));
		expect(screen.getByText("New preview")).toBeTruthy();
		await act(async () => resolveOld(document("Stale preview")));
		expect(screen.queryByText("Stale preview")).toBeNull();
		expect(renderDocument.mock.calls.map(([content]) => content)).toEqual(["old", "new"]);
	});
	it("clears previous entity text during rerender and handles errors safely", async () => {
		vi.useFakeTimers({
			toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
		});
		renderDocument.mockRejectedValue(new Error("private diagnostic"));
		const view = render(<MarkdownPreview content="old" initial={document("Old entity")} />);
		view.rerender(<MarkdownPreview content="next" />);
		expect(screen.queryByText("Old entity")).toBeNull();
		await act(() => vi.advanceTimersByTimeAsync(200));
		expect(screen.getByText("Unable to render Markdown.")).toBeTruthy();
		expect(screen.queryByText("private diagnostic")).toBeNull();
	});
});
