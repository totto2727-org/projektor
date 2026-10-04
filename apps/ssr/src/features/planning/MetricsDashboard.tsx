"use client";

import { useForm } from "@tanstack/react-form";
import { Schema } from "effect";
import { type ReactNode, useRef } from "react";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Select";
import { CodeHeatmap } from "./CodeHeatmap";
import {
	AgingWipScatter,
	ArrivalVsCompletionChart,
	BugShareChart,
	CfdChart,
	ReviewLatencyChart,
	ThroughputChart,
	WipChart,
} from "./flow-charts";
import { FormErrors } from "./form-ui";
import { formatCount, formatDuration, formatPercent, rangeFromUrl } from "./helpers";
import { MetricsWindowSchema } from "./input-schemas";
import { MetricHelp, SectionHeading } from "./MetricHelp";
import { METRIC_DEFINITIONS, type MetricId } from "./metric-definitions";
import type {
	CodeHeatmapResponse,
	Distribution,
	FlowMetrics,
	HeatmapMode,
	RangeState,
} from "./types";

function StatTile({ label, value }: { label: string; value: string }) {
	return (
		<div className="px-4 py-3 bg-surface border border-border rounded-lg min-w-0">
			<p className="m-0 mb-1 text-[0.72rem] font-semibold text-text-muted uppercase tracking-[0.04em]">
				{label}
			</p>
			<p className="m-0 text-lg font-semibold text-text-base">{value}</p>
		</div>
	);
}
function DistributionTiles({
	metricId,
	title,
	caption,
	dist,
	format = formatDuration,
	showHeading = true,
}: {
	metricId: MetricId;
	title?: string;
	caption?: string;
	dist: Distribution;
	format?: (value: number | null) => string;
	showHeading?: boolean;
}) {
	return (
		<div className="mb-8">
			{showHeading && (
				<h2 className="m-0 mb-1 text-base font-semibold text-text-base inline-flex items-center gap-1.5">
					{title ?? METRIC_DEFINITIONS[metricId].label}
					<MetricHelp id={metricId} />
				</h2>
			)}
			{showHeading && caption && (
				<p className="m-0 mb-3 text-[0.72rem] text-text-muted">{caption}</p>
			)}
			<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
				<StatTile label="Count" value={String(dist.count)} />
				<StatTile label="Avg" value={format(dist.avg)} />
				<StatTile label="p50" value={format(dist.p50)} />
				<StatTile label="p90" value={format(dist.p90)} />
			</div>
		</div>
	);
}
function HealthTile({ metricId, value }: { metricId: MetricId; value: number }) {
	const flagged = value > 0;
	return (
		<div
			className={`px-4 py-3 bg-surface border rounded-lg min-w-0 ${flagged ? "" : "border-border"}`}
			style={
				flagged
					? { borderColor: "var(--priority-high-text)", background: "var(--priority-high-bg)" }
					: undefined
			}
		>
			<p className="m-0 mb-1 text-[0.72rem] font-semibold text-text-muted uppercase tracking-[0.04em] inline-flex items-center gap-1">
				{METRIC_DEFINITIONS[metricId].label}
				<MetricHelp id={metricId} />
			</p>
			<p
				className={`m-0 text-lg font-semibold ${flagged ? "" : "text-text-base"}`}
				style={flagged ? { color: "var(--priority-high-text)" } : undefined}
			>
				{value}
			</p>
		</div>
	);
}
function SectionBand({ title, children }: { title?: string; children: ReactNode }) {
	return (
		<section className="mb-10">
			{title && (
				<h2 className="m-0 mb-4 pb-2 text-lg font-bold text-text-base border-b border-border">
					{title}
				</h2>
			)}
			<div className="flex flex-col">{children}</div>
		</section>
	);
}
function ChartSection({
	id,
	caption,
	children,
}: {
	id: MetricId;
	caption?: string;
	children: ReactNode;
}) {
	return (
		<div className="mb-8">
			<SectionHeading metricId={id} caption={caption} />
			<div className="p-4 bg-surface border border-border rounded-lg overflow-x-auto">
				{children}
			</div>
		</div>
	);
}
function FlowBand({ metrics }: { metrics: FlowMetrics }) {
	return (
		<SectionBand title="Flow">
			<DistributionTiles metricId="lead-time" dist={metrics.leadTime} />
			<DistributionTiles metricId="cycle-time" dist={metrics.cycleTime} />
			<ChartSection id="throughput">
				<ThroughputChart data={metrics.throughputOverTime} />
			</ChartSection>
			<ChartSection
				id="bug-share"
				caption="Bugs as a share of completed throughput. A rising trend is a quality signal, not just a volume one"
			>
				<BugShareChart data={metrics.bugShareOverTime} bugTypeTracked={metrics.bugTypeTracked} />
			</ChartSection>
			<ChartSection id="wip">
				<WipChart data={metrics.wipOverTime} />
			</ChartSection>
			<ChartSection
				id="aging-wip"
				caption="Age since claim for every currently open issue, against this window's cycle-time p50/p90. Stuck items show up before they finish and skew the percentiles"
			>
				<AgingWipScatter
					data={metrics.agingWip}
					p50={metrics.cycleTime.p50}
					p90={metrics.cycleTime.p90}
				/>
			</ChartSection>
			<div className="mb-8">
				<SectionHeading
					metricId="cumulative-flow"
					caption="Issue counts per status category over time. A widening band is where the factory is choking"
				/>
				<div className="p-4 bg-surface border border-border rounded-lg overflow-x-auto mb-3">
					<CfdChart data={metrics.cfdOverTime} />
				</div>
				<DistributionTiles
					metricId="time-in-progress"
					caption="Review latency has its own breakdown in Efficiency & collaboration, below"
					dist={metrics.timeInProgress}
				/>
			</div>
			<ChartSection
				id="arrival-vs-completion"
				caption="Issues created vs completed per bucket, with the net. Is the backlog growing or burning?"
			>
				<ArrivalVsCompletionChart data={metrics.arrivalVsCompletionOverTime} />
			</ChartSection>
		</SectionBand>
	);
}
function EfficiencyBand({ metrics }: { metrics: FlowMetrics }) {
	return (
		<SectionBand title="Efficiency & collaboration">
			<DistributionTiles
				metricId="flow-efficiency"
				caption="Lease-held time ÷ lead time. How much of the wait, not just the work, was agent-driven"
				dist={metrics.flowEfficiency}
				format={formatPercent}
			/>
			<DistributionTiles
				metricId="autonomy-ratio"
				dist={metrics.autonomyRatio}
				format={formatPercent}
			/>
			<div className="mb-8">
				<SectionHeading metricId="review-latency" />
				<div className="p-4 bg-surface border border-border rounded-lg overflow-x-auto mb-3">
					<ReviewLatencyChart data={metrics.reviewLatencyOverTime} />
				</div>
				<DistributionTiles
					metricId="review-latency"
					dist={metrics.reviewLatency}
					showHeading={false}
				/>
			</div>
			<DistributionTiles
				metricId="human-interventions"
				title="Human interventions per issue"
				dist={metrics.humanInterventions}
				format={formatCount}
			/>
		</SectionBand>
	);
}
function FactoryHealthBand({ health }: { health: FlowMetrics["factoryHealth"] }) {
	return (
		<SectionBand title="Factory health">
			<div className="mb-8">
				<p className="m-0 mb-3 text-[0.72rem] text-text-muted">
					Fault signals for the factory itself, for the selected window. A low background rate is
					normal. Watch the trend, not any single nonzero tile.
				</p>
				<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
					<HealthTile metricId="lease-expiries" value={health.leaseExpiries} />
					<HealthTile metricId="abandoned-claims" value={health.abandonedClaims} />
					<HealthTile metricId="gate-rejections" value={health.gateRejections} />
					<HealthTile metricId="wip-cap-pressure" value={health.wipCapPressure} />
				</div>
			</div>
		</SectionBand>
	);
}
/** All primary charts and heatmap arrive in SSR props. Applying a range is a normal GET. */
export function MetricsDashboard({
	projectId,
	workspaceSlug,
	initialMetrics: metrics,
	initialUrl,
	initialRange,
	initialHeatmap = null,
	heatmapMode = "claims",
	heatmapError,
}: {
	projectId: string;
	workspaceSlug: string;
	initialMetrics: FlowMetrics;
	initialUrl: string;
	initialRange?: RangeState;
	initialHeatmap?: CodeHeatmapResponse | null;
	heatmapMode?: HeatmapMode;
	heatmapError?: string | null;
}) {
	const defaults = useRef({
		workspaceSlug,
		projectId,
		...(initialRange ?? rangeFromUrl(new URL(initialUrl))),
		heatmapMode,
		prefix: new URL(initialUrl).searchParams.get("prefix") ?? "",
	}).current;
	const element = useRef<HTMLFormElement>(null);
	const standard = Schema.toStandardSchemaV1(MetricsWindowSchema);
	const form = useForm({
		defaultValues: defaults,
		validators: { onMount: standard, onChange: standard, onSubmit: standard },
		onSubmit: () => element.current?.submit(),
	});
	return (
		<div>
			<h1 className="m-0 mb-5 text-2xl font-bold text-text-base">Metrics</h1>
			<form
				ref={element}
				method="get"
				action={new URL(initialUrl).pathname}
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					void form.handleSubmit();
				}}
				className="flex flex-wrap items-end gap-4 mb-6"
			>
				<form.Subscribe
					selector={(state) => ({
						range: state.values,
						canSubmit: state.canSubmit,
						errors: state.errors,
						showErrors: state.isDirty || state.submissionAttempts > 0,
					})}
				>
					{({ range, canSubmit, errors, showErrors }) => (
						<>
							<input type="hidden" name="projectId" value={projectId} />
							<input type="hidden" name="workspace" value={workspaceSlug} />
							<input type="hidden" name="granularity" value={range.granularity} />
							<input type="hidden" name="heatmapMode" value={heatmapMode} />
							<input type="hidden" name="prefix" value={range.prefix} />
							<label className="text-[0.7rem] text-text-muted" htmlFor="metrics-since">
								From
								<form.Field name="since">
									{(field) => (
										<input
											id="metrics-since"
											type="date"
											name="since"
											aria-label="From date"
											value={field.state.value}
											max={range.until}
											required
											onBlur={field.handleBlur}
											onChange={(event) => field.handleChange(event.currentTarget.value)}
											className="block px-2 py-[0.3rem] border border-border rounded text-sm bg-bg text-text-base mt-[0.2rem]"
										/>
									)}
								</form.Field>
							</label>
							<label className="text-[0.7rem] text-text-muted" htmlFor="metrics-until">
								To
								<form.Field name="until">
									{(field) => (
										<input
											id="metrics-until"
											type="date"
											name="until"
											aria-label="To date"
											value={field.state.value}
											min={range.since}
											required
											onBlur={field.handleBlur}
											onChange={(event) => field.handleChange(event.currentTarget.value)}
											className="block px-2 py-[0.3rem] border border-border rounded text-sm bg-bg text-text-base mt-[0.2rem]"
										/>
									)}
								</form.Field>
							</label>
							<div className="text-[0.7rem] text-text-muted">
								Granularity
								<div className="mt-[0.2rem]">
									<form.Field name="granularity">
										{(field) => (
											<Select
												value={field.state.value}
												options={[
													{ value: "week", label: "Weekly" },
													{ value: "day", label: "Daily" },
												]}
												ariaLabel="Chart granularity"
												onChange={(value) => field.handleChange(value as "day" | "week")}
											/>
										)}
									</form.Field>
								</div>
							</div>
							<Button type="submit" variant="outline" size="sm" disabled={!canSubmit}>
								Apply
							</Button>
							{showErrors && <FormErrors errors={errors} />}
						</>
					)}
				</form.Subscribe>
			</form>
			<FlowBand metrics={metrics} />
			<EfficiencyBand metrics={metrics} />
			<SectionBand>
				<CodeHeatmap
					data={initialHeatmap}
					mode={heatmapMode}
					initialUrl={initialUrl}
					error={heatmapError}
				/>
			</SectionBand>
			<FactoryHealthBand health={metrics.factoryHealth} />
		</div>
	);
}
