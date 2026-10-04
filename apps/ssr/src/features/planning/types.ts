export interface Sprint {
	id: string;
	name: string;
	goal: string | null;
	status: "planned" | "active" | "completed";
	startDate: number | null;
	endDate: number | null;
	projectId: string;
	createdAt: number;
}
export interface SprintIssue {
	id: string;
	title: string;
	number: number;
	status_category: string | null;
	project_key: string | null;
	sprint_id: string | null;
	customFields: { key: string; value: string }[];
}
export interface ProjectIdentity {
	id: string;
	name: string;
	key: string;
}
export interface Distribution {
	count: number;
	avg: number | null;
	p50: number | null;
	p90: number | null;
}
export interface FlowMetrics {
	leadTime: Distribution;
	cycleTime: Distribution;
	reviewLatency: Distribution;
	humanInterventions: Distribution;
	autonomyRatio: Distribution;
	timeInProgress: Distribution;
	flowEfficiency: Distribution;
	wipOverTime: { date: string; count: number }[];
	throughputOverTime: { bucketStart: string; count: number }[];
	bugShareOverTime: {
		bucketStart: string;
		total: number;
		bugCount: number;
		bugSharePercent: number | null;
	}[];
	bugTypeTracked: boolean;
	reviewLatencyOverTime: { bucketStart: string; p50: number | null }[];
	cfdOverTime: {
		bucketStart: string;
		backlogTodo: number;
		inProgress: number;
		inReview: number;
		done: number;
	}[];
	arrivalVsCompletionOverTime: {
		bucketStart: string;
		created: number;
		completed: number;
		net: number;
	}[];
	agingWip: { id: string; status: "in_progress" | "in_review"; ageSeconds: number }[];
	factoryHealth: {
		leaseExpiries: number;
		abandonedClaims: number;
		gateRejections: number;
		wipCapPressure: number;
	};
}
export interface RangeState {
	since: string;
	until: string;
	granularity: "day" | "week";
}
export type HeatmapMode = "claims" | "contention";
export interface CodeHeatmapEntry {
	path: string;
	segment: string;
	isLeaf: boolean;
	distinctIssueCount?: number;
	claimCount?: number;
	distinctRejectedIssueCount?: number;
	conflictCount?: number;
}
export interface CodeHeatmapResponse {
	prefix: string;
	totalDistinctIssues: number;
	entries: CodeHeatmapEntry[];
}
