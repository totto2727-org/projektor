// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { FormErrors } from "./FormErrors";

describe("FormErrors", () => {
	it("renders deduplicated Standard Schema and TanStack error messages accessibly", () => {
		render(
			<FormErrors
				id="project-errors"
				errors={{
					errors: [{ message: "Name is required" }, { message: "Name is required" }],
					errorMap: { onSubmit: [{ message: "Key is already used" }] },
				}}
			/>,
		);
		const alert = screen.getByRole("alert", { name: "Validation errors" });
		expect(alert.getAttribute("id")).toBe("project-errors");
		expect(alert.textContent).toContain("Name is required");
		expect(alert.textContent).toContain("Key is already used");
	});
});
