// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type uPlot from "uplot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { CodeHeatmap } from "./CodeHeatmap";
import { MetricsDashboard } from "./MetricsDashboard";
import type { FlowMetrics } from "./types";

const charts = vi.hoisted(() => [] as { data: uPlot.AlignedData; options: uPlot.Options }[]);
vi.hoisted(() => {
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
	);
});
vi.mock("./UplotChart", () => ({
	default: (props: {
		data: uPlot.AlignedData;
		buildOptions: (width: number, height: number) => uPlot.Options;
	}) => {
		const options = props.buildOptions(600, 220);
		charts.push({ data: props.data, options });
		return <div data-testid="uplot" />;
	},
	createTooltipPlugin: () => ({ hooks: {} }),
}));
const distribution = { count: 2, avg: 3600, p50: 1800, p90: 7200 };
const metrics = (): FlowMetrics => ({
	leadTime: distribution,
	cycleTime: distribution,
	reviewLatency: distribution,
	humanInterventions: { count: 2, avg: 1.5, p50: 1, p90: 2 },
	autonomyRatio: { count: 2, avg: 0.75, p50: 0.5, p90: 0.9 },
	timeInProgress: distribution,
	flowEfficiency: { count: 2, avg: 0.25, p50: 0.5, p90: 0.9 },
	wipOverTime: [{ date: "2026-10-01", count: 3 }],
	throughputOverTime: [{ bucketStart: "2026-10-01", count: 4 }],
	bugShareOverTime: [
		{ bucketStart: "2026-10-01", total: 4, bugCount: 1, bugSharePercent: 0.25 },
		{ bucketStart: "2026-10-02", total: 0, bugCount: 0, bugSharePercent: null },
	],
	bugTypeTracked: true,
	reviewLatencyOverTime: [{ bucketStart: "2026-10-01", p50: 1800 }],
	cfdOverTime: [{ bucketStart: "2026-10-01", backlogTodo: 4, inProgress: 3, inReview: 2, done: 1 }],
	arrivalVsCompletionOverTime: [{ bucketStart: "2026-10-01", created: 6, completed: 4, net: 2 }],
	agingWip: [
		{ id: "i1", status: "in_progress", ageSeconds: 86400 },
		{ id: "i2", status: "in_review", ageSeconds: 3600 },
	],
	factoryHealth: { leaseExpiries: 1, abandonedClaims: 2, gateRejections: 3, wipCapPressure: 4 },
});
const props = {
	projectId: "p1",
	workspaceSlug: "alpha",
	initialUrl:
		"https://front.example/metrics?projectId=p1&workspace=alpha&since=2026-09-01&until=2026-10-01",
	initialHeatmap: {
		prefix: "",
		totalDistinctIssues: 2,
		entries: [{ path: "src", segment: "src", isLeaf: false, distinctIssueCount: 2 }],
	},
};
afterEach(cleanup);
beforeEach(() => {
	charts.length = 0;
});

describe("full original metrics surfaces", () => {
	it("uses the shared Effect Standard Schema to block reversed native GET ranges", async () => {
		const nativeSubmit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
		render(<MetricsDashboard {...props} initialMetrics={metrics()} />);
		fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-10-05" } });
		fireEvent.submit(
			screen.getByRole("button", { name: "Apply" }).closest("form") as HTMLFormElement,
		);
		await waitFor(() =>
			expect(screen.getByRole("alert").textContent).toContain("To date must not precede"),
		);
		expect(nativeSubmit).not.toHaveBeenCalled();
		nativeSubmit.mockRestore();
	});
	it("renders all seven uPlot charts, distribution tiles, help controls, and factory signals without mount loads", () => {
		render(<MetricsDashboard {...props} initialMetrics={metrics()} />);
		expect(screen.getAllByTestId("uplot").length).toBe(7);
		for (const title of [
			"Flow",
			"Efficiency & collaboration",
			"Lead time",
			"Cycle time",
			"Throughput",
			"Bug share",
			"WIP over time",
			"Aging WIP",
			"Cumulative flow",
			"Time in progress",
			"Arrival vs completion",
			"Flow efficiency",
			"Autonomy ratio",
			"Review latency",
			"Human interventions per issue",
			"Where work lands",
			"Factory health",
		])
			expect(screen.getByRole("heading", { name: title })).toBeTruthy();
		expect(screen.getAllByText("Count").length).toBe(7);
		for (const label of [
			"Lease expiries",
			"Abandoned claims",
			"Gate rejections",
			"WIP-cap pressure",
		])
			expect(screen.getByRole("button", { name: `About ${label}` })).toBeTruthy();
	});
	it("uses exact CFD cumulative bands/legend, gapped bug fractions, and aging baseline columns", () => {
		render(<MetricsDashboard {...props} initialMetrics={metrics()} />);
		const cfd = charts.find((chart) => chart.options.series[1].label === "Backlog/todo");
		expect(cfd?.data).toEqual([[0], [10], [6], [3], [1]]);
		const value = cfd?.options.series[1].value;
		if (typeof value !== "function" || !cfd) throw new Error("Missing de-cumulated CFD legend");
		expect(value({ data: cfd.data } as uPlot, 10, 1, 0)).toBe(4);
		const bug = charts.find((chart) => chart.options.series[1].label === "Bug share");
		expect(bug?.data[1]).toEqual([0.25, null]);
		expect(bug?.options.scales?.y.range).toEqual([0, 1]);
		const aging = charts.find((chart) => chart.options.series[1].label === "Age since claim");
		expect(aging?.data[2]).toEqual([1800, 1800]);
		expect(aging?.data[3]).toEqual([7200, 7200]);
	});
	it("adopts refreshed metrics while preserving unsaved range and uses shareable normal GET forms", () => {
		const view = render(<MetricsDashboard {...props} initialMetrics={metrics()} />);
		fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-08-01" } });
		const next = metrics();
		next.leadTime = { count: 77, avg: 7200, p50: 7200, p90: 7200 };
		view.rerender(<MetricsDashboard {...props} initialMetrics={next} />);
		expect((screen.getByLabelText("From date") as HTMLInputElement).value).toBe("2026-08-01");
		expect(screen.getByText("77")).toBeTruthy();
		const form = screen.getByRole("button", { name: "Apply" }).closest("form");
		expect(form?.method).toBe("get");
		expect(form?.getAttribute("action")).toBe("/metrics");
		expect(new FormData(form as HTMLFormElement).get("workspace")).toBe("alpha");
	});
	it("retains metric help toggletips and dismisses on Escape", () => {
		render(<MetricsDashboard {...props} initialMetrics={metrics()} />);
		fireEvent.click(screen.getByRole("button", { name: "About Flow efficiency" }));
		expect(
			screen.getByRole("dialog", { name: "Flow efficiency definition" }).textContent,
		).toContain("lease-held time ÷ lead time");
		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.queryByRole("dialog")).toBeNull();
	});
	it("preserves claim/contention toggle, breadcrumb drill paths, proportional bars and leaf distinction", () => {
		const view = render(
			<CodeHeatmap
				data={{
					prefix: "src",
					totalDistinctIssues: 3,
					entries: [
						{ path: "src/api", segment: "api", isLeaf: false, distinctRejectedIssueCount: 3 },
						{
							path: "src/index.ts",
							segment: "index.ts",
							isLeaf: true,
							distinctRejectedIssueCount: 1,
						},
					],
				}}
				mode="contention"
				initialUrl={props.initialUrl}
			/>,
		);
		expect(screen.getByRole("heading", { name: "Where the fleet queues up" })).toBeTruthy();
		const drill = screen.getByTitle("View files under src/api");
		expect(drill.getAttribute("href")).toContain("prefix=src%2Fapi");
		expect(screen.getByRole("link", { name: "Claim volume" }).getAttribute("href")).toContain(
			"heatmapMode=claims",
		);
		expect(screen.getByText("index.ts").closest("a")).toBeNull();
		view.rerender(
			<CodeHeatmap
				data={{ prefix: "", totalDistinctIssues: 0, entries: [] }}
				mode="contention"
				initialUrl={props.initialUrl}
			/>,
		);
		expect(screen.getByText("No claim conflicts in this window")).toBeTruthy();
	});
});
