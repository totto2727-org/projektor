"use client";

import { useMemo } from "react";
import uPlot from "uplot";
import { formatDuration, formatPercent } from "./helpers";
import type { FlowMetrics } from "./types";
import UplotChart, { createTooltipPlugin } from "./UplotChart";

export function readThemeColor(token: string, fallback: string): string {
	return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || fallback;
}
export function hexToRgba(hex: string, alpha: number): string {
	const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
	if (!match) return hex;
	const [r, g, b] = match.slice(1).map((value) => Number.parseInt(value, 16));
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
export function formatShortDate(iso: string): string {
	const date = new Date(`${iso}T00:00:00Z`);
	return Number.isNaN(date.getTime())
		? iso
		: date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
export function formatFullDate(iso: string): string {
	const date = new Date(`${iso}T00:00:00Z`);
	return Number.isNaN(date.getTime())
		? iso
		: date.toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
				year: "numeric",
				timeZone: "UTC",
			});
}
export function readChartSeqColors() {
	return {
		backlogTodo: readThemeColor("--chart-seq-1", "#94c2c8"),
		inProgress: readThemeColor("--chart-seq-2", "#54a1aa"),
		inReview: readThemeColor("--chart-seq-3", "#007a87"),
		done: readThemeColor("--chart-seq-4", "#005963"),
	};
}
export function tickIndices(width: number, labels: readonly string[]): number[] {
	if (!labels.length) return [];
	const stride = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(width / 70))));
	const indices: number[] = [];
	for (let index = 0; index < labels.length; index += stride) indices.push(index);
	if (indices.at(-1) !== labels.length - 1) indices.push(labels.length - 1);
	return indices;
}
export function EmptyChartState({ message }: { message: string }) {
	return (
		<div className="flex items-center justify-center h-[220px] text-sm text-text-muted">
			{message}
		</div>
	);
}
function chartAxes(labels: string[], formatY?: (value: number) => string): uPlot.Axis[] {
	const border = readThemeColor("--border", "#e2e8f0");
	const muted = readThemeColor("--text-muted", "#6b7280");
	return [
		{
			stroke: muted,
			grid: { stroke: border },
			splits: (chart) => tickIndices(chart.width, labels),
			values: (_chart, splits) => splits.map((value) => formatShortDate(labels[value] ?? "")),
		},
		{
			stroke: muted,
			grid: { stroke: border },
			...(formatY ? { values: (_chart: uPlot, ticks: number[]) => ticks.map(formatY) } : {}),
		},
	];
}
export function ThroughputChart({ data }: { data: FlowMetrics["throughputOverTime"] }) {
	const labels = useMemo(() => data.map((point) => point.bucketStart), [data]);
	const chartData = useMemo<uPlot.AlignedData>(
		() => [data.map((_, index) => index), data.map((point) => point.count)],
		[data],
	);
	const buildOptions = useMemo(
		() =>
			(width: number, height: number): uPlot.Options => {
				const accent = readThemeColor("--accent", "#007a87");
				return {
					width,
					height,
					scales: { x: { time: false } },
					legend: { show: false },
					series: [
						{},
						{
							label: "Issues completed",
							stroke: accent,
							fill: hexToRgba(accent, 0.25),
							paths: uPlot.paths.bars?.(),
						},
					],
					axes: chartAxes(labels),
					plugins: [
						createTooltipPlugin({
							formatX: (value) => formatFullDate(labels[value] ?? ""),
							formatY: (value) => `${value} completed`,
						}),
					],
				};
			},
		[labels],
	);
	if (!data.length || data.every((point) => point.count === 0))
		return <EmptyChartState message="No completed issues yet" />;
	return <UplotChart data={chartData} buildOptions={buildOptions} />;
}
/** Original cumulative area geometry and de-cumulated legend, not an approximate SVG. */
export function CfdChart({ data }: { data: FlowMetrics["cfdOverTime"] }) {
	const labels = useMemo(() => data.map((point) => point.bucketStart), [data]);
	const chartData = useMemo<uPlot.AlignedData>(
		() => [
			data.map((_, index) => index),
			data.map((point) => point.backlogTodo + point.inProgress + point.inReview + point.done),
			data.map((point) => point.inProgress + point.inReview + point.done),
			data.map((point) => point.inReview + point.done),
			data.map((point) => point.done),
		],
		[data],
	);
	const buildOptions = useMemo(
		() =>
			(width: number, height: number): uPlot.Options => {
				const colors = readChartSeqColors();
				return {
					width,
					height,
					scales: { x: { time: false } },
					legend: { show: true },
					series: [
						{},
						{
							label: "Backlog/todo",
							stroke: colors.backlogTodo,
							fill: colors.backlogTodo,
							value: (chart, _value, _series, index) =>
								index == null ? "" : (chart.data[1][index] ?? 0) - (chart.data[2][index] ?? 0),
						},
						{
							label: "In progress",
							stroke: colors.inProgress,
							fill: colors.inProgress,
							value: (chart, _value, _series, index) =>
								index == null ? "" : (chart.data[2][index] ?? 0) - (chart.data[3][index] ?? 0),
						},
						{
							label: "In review",
							stroke: colors.inReview,
							fill: colors.inReview,
							value: (chart, _value, _series, index) =>
								index == null ? "" : (chart.data[3][index] ?? 0) - (chart.data[4][index] ?? 0),
						},
						{
							label: "Done",
							stroke: colors.done,
							fill: colors.done,
							value: (_chart, value) => value ?? "",
						},
					],
					axes: chartAxes(labels),
				};
			},
		[labels],
	);
	if (
		!data.length ||
		data.every((point) => point.backlogTodo + point.inProgress + point.inReview + point.done === 0)
	)
		return <EmptyChartState message="No issues in this window yet" />;
	return <UplotChart data={chartData} buildOptions={buildOptions} />;
}
export function BugShareChart({
	data,
	bugTypeTracked,
}: {
	data: FlowMetrics["bugShareOverTime"];
	bugTypeTracked: boolean;
}) {
	const labels = useMemo(() => data.map((point) => point.bucketStart), [data]);
	const chartData = useMemo<uPlot.AlignedData>(
		() => [data.map((_, index) => index), data.map((point) => point.bugSharePercent)],
		[data],
	);
	const buildOptions = useMemo(
		() =>
			(width: number, height: number): uPlot.Options => ({
				width,
				height,
				scales: { x: { time: false }, y: { range: [0, 1] } },
				legend: { show: false },
				series: [
					{},
					{
						label: "Bug share",
						stroke: readThemeColor("--accent", "#007a87"),
						width: 2,
						points: { show: true },
					},
				],
				axes: chartAxes(labels, formatPercent),
				plugins: [
					createTooltipPlugin({
						formatX: (value) => formatFullDate(labels[value] ?? ""),
						formatY: formatPercent,
					}),
				],
			}),
		[labels],
	);
	if (!bugTypeTracked)
		return (
			<EmptyChartState message={'Not tracked: no task type keyed "bug" exists in this workspace'} />
		);
	if (!data.length || data.every((point) => point.bugSharePercent === null))
		return <EmptyChartState message="No completed issues yet" />;
	return <UplotChart data={chartData} buildOptions={buildOptions} />;
}
export function ReviewLatencyChart({ data }: { data: FlowMetrics["reviewLatencyOverTime"] }) {
	const labels = useMemo(() => data.map((point) => point.bucketStart), [data]);
	const chartData = useMemo<uPlot.AlignedData>(
		() => [data.map((_, index) => index), data.map((point) => point.p50)],
		[data],
	);
	const buildOptions = useMemo(
		() =>
			(width: number, height: number): uPlot.Options => ({
				width,
				height,
				scales: { x: { time: false } },
				legend: { show: false },
				series: [
					{},
					{
						label: "Review latency (p50)",
						stroke: readThemeColor("--accent", "#007a87"),
						width: 2,
						points: { show: true },
					},
				],
				axes: chartAxes(labels, formatDuration),
				plugins: [
					createTooltipPlugin({
						formatX: (value) => formatFullDate(labels[value] ?? ""),
						formatY: formatDuration,
					}),
				],
			}),
		[labels],
	);
	if (!data.length || data.every((point) => point.p50 === null))
		return <EmptyChartState message="No review-latency data yet" />;
	return <UplotChart data={chartData} buildOptions={buildOptions} />;
}
export function WipChart({ data }: { data: FlowMetrics["wipOverTime"] }) {
	const chartData = useMemo<uPlot.AlignedData>(
		() => [
			data.map((point) => Math.floor(new Date(point.date).getTime() / 1000)),
			data.map((point) => point.count),
		],
		[data],
	);
	const buildOptions = useMemo(
		() =>
			(width: number, height: number): uPlot.Options => {
				const border = readThemeColor("--border", "#e2e8f0");
				const muted = readThemeColor("--text-muted", "#6b7280");
				return {
					width,
					height,
					scales: { x: { time: true } },
					legend: { show: false },
					series: [{}, { label: "WIP", stroke: readThemeColor("--accent", "#007a87"), width: 2 }],
					axes: [
						{ stroke: muted, grid: { stroke: border }, space: 60 },
						{ stroke: muted, grid: { stroke: border } },
					],
					plugins: [
						createTooltipPlugin({
							formatX: (value) =>
								new Date(value * 1000).toLocaleDateString("en-US", {
									month: "short",
									day: "numeric",
									year: "numeric",
									timeZone: "UTC",
								}),
							formatY: (value) => `${value} in progress`,
						}),
					],
				};
			},
		[],
	);
	if (!data.length || data.every((point) => point.count === 0))
		return <EmptyChartState message="No WIP data yet" />;
	return <UplotChart data={chartData} buildOptions={buildOptions} />;
}
export function ArrivalVsCompletionChart({
	data,
}: {
	data: FlowMetrics["arrivalVsCompletionOverTime"];
}) {
	const labels = useMemo(() => data.map((point) => point.bucketStart), [data]);
	const chartData = useMemo<uPlot.AlignedData>(
		() => [
			data.map((_, index) => index),
			data.map((point) => point.created),
			data.map((point) => point.completed),
			data.map((point) => point.net),
		],
		[data],
	);
	const buildOptions = useMemo(
		() =>
			(width: number, height: number): uPlot.Options => ({
				width,
				height,
				scales: { x: { time: false } },
				legend: { show: true },
				series: [
					{},
					{
						label: "Created",
						stroke: readThemeColor("--chart-secondary", "#d97706"),
						width: 2,
						points: { show: false },
					},
					{
						label: "Completed",
						stroke: readThemeColor("--accent", "#007a87"),
						width: 2,
						points: { show: false },
					},
					{
						label: "Net (created − completed)",
						stroke: readThemeColor("--text-muted", "#6b7280"),
						width: 1,
						dash: [4, 4],
						points: { show: false },
					},
				],
				axes: chartAxes(labels),
			}),
		[labels],
	);
	if (!data.length || data.every((point) => point.created === 0 && point.completed === 0))
		return <EmptyChartState message="No arrivals or completions yet" />;
	return <UplotChart data={chartData} buildOptions={buildOptions} />;
}
export function hashJitter(id: string): number {
	let hash = 0;
	for (let index = 0; index < id.length; index++) hash = (hash * 31 + id.charCodeAt(index)) | 0;
	return ((hash >>> 0) % 1000) / 1000;
}
export function AgingWipScatter({
	data,
	p50,
	p90,
}: {
	data: FlowMetrics["agingWip"];
	p50: number | null;
	p90: number | null;
}) {
	const points = useMemo(
		() =>
			data
				.map((point) => ({
					...point,
					x: (point.status === "in_progress" ? 0 : 1) + (hashJitter(point.id) - 0.5) * 0.5,
				}))
				.sort((a, b) => a.x - b.x),
		[data],
	);
	const chartData = useMemo<uPlot.AlignedData>(() => {
		const xs = points.map((point) => point.x);
		return [xs, points.map((point) => point.ageSeconds), xs.map(() => p50), xs.map(() => p90)];
	}, [points, p50, p90]);
	const buildOptions = useMemo(
		() =>
			(width: number, height: number): uPlot.Options => {
				const border = readThemeColor("--border", "#e2e8f0");
				const muted = readThemeColor("--text-muted", "#6b7280");
				return {
					width,
					height,
					scales: { x: { time: false, range: [-0.5, 1.5] } },
					legend: { show: true },
					series: [
						{},
						{
							label: "Age since claim",
							stroke: readChartSeqColors().inProgress,
							points: { show: true, size: 8 },
							paths: () => null,
						},
						{
							label: "p50 cycle time",
							stroke: muted,
							width: 1,
							dash: [4, 4],
							points: { show: false },
						},
						{
							label: "p90 cycle time",
							stroke: muted,
							width: 1,
							dash: [2, 2],
							points: { show: false },
						},
					],
					axes: [
						{
							stroke: muted,
							grid: { stroke: border },
							splits: () => [0, 1],
							values: (_chart, splits) =>
								splits.map((value) => (value === 0 ? "In progress" : "In review")),
						},
						{
							stroke: muted,
							grid: { stroke: border },
							values: (_chart, ticks) => ticks.map(formatDuration),
						},
					],
				};
			},
		[],
	);
	if (!data.length) return <EmptyChartState message="No issues currently in progress or review" />;
	return <UplotChart data={chartData} buildOptions={buildOptions} />;
}
