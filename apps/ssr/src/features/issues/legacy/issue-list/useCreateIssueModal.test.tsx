// @vitest-environment jsdom
import "../../test/browser";
// Native ActionState keeps typed server failures in the open form without discarding its TanStack draft.
// Unexpected browser transport failures belong to the root React error boundary.
import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { createIssue } from "../../actions";
import CreateIssueModal from "./CreateIssueModal";
import { useCreateIssueModal } from "./useCreateIssueModal";

const PROJECTS = [
	{ id: "p1", key: "PROJ", name: "Projektor", description: null, workspace_slug: "test-workspace" },
];

function Harness() {
	const modal = useCreateIssueModal({
		filterProject: "",
		projects: PROJECTS,
	});
	// The real flow sets createProjectId via openCreateModal() when the "New issue"
	// button is clicked; this harness skips that button and opens the modal directly.
	// biome-ignore lint/correctness/useExhaustiveDependencies: test harness opens the modal exactly once, as a user click would.
	useEffect(() => {
		modal.openCreateModal();
	}, []);
	return <CreateIssueModal {...modal} projects={PROJECTS} taskTypes={[]} statuses={[]} />;
}

describe("useCreateIssueModal native ActionState failures", () => {
	it("keeps the entered draft when the server reports backend unavailability", async () => {
		vi.mocked(createIssue).mockResolvedValueOnce({
			ok: false,
			status: 502,
			message: "The API is currently unreachable.",
		});

		render(<Harness />);
		fireEvent.input(screen.getByPlaceholderText("Issue title"), {
			target: { value: "Fix the thing" },
		});
		fireEvent.click(screen.getByRole("button", { name: /create issue/i }));

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toMatch(/API is currently unreachable/i);
		expect((screen.getByPlaceholderText("Issue title") as HTMLInputElement).value).toBe(
			"Fix the thing"
		);
		const formData = vi.mocked(createIssue).mock.calls[0][1];
		expect(formData.get("title")).toBe("Fix the thing");
		expect(formData.get("projectId")).toBe("p1");
		expect(formData.get("priority")).toBe("medium");
	});

	it("shows a generic message for a non-offline (HTTP) failure", async () => {
		vi.mocked(createIssue).mockResolvedValueOnce({
			ok: false,
			status: 500,
			message: "Request failed",
		});

		render(<Harness />);
		fireEvent.input(screen.getByPlaceholderText("Issue title"), {
			target: { value: "Fix the thing" },
		});
		fireEvent.click(screen.getByRole("button", { name: /create issue/i }));

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toMatch(/failed to create issue/i);
		expect(alert.textContent).not.toMatch(/you're offline/i);
	});
});
