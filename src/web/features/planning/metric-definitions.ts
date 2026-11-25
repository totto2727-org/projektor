import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import type { FieldsInOrder } from '#contracts/ordered-fields.ts'

type MetricDefinition<Label extends string, Definition extends string, Computation extends string> = Readonly<{
  label: Label
  definition: Definition
  computation: Computation
}>

const metricDefinition = function metricDefinition<
  Label extends string,
  Definition extends string,
  Computation extends string,
>(label: Label, definition: Definition, computation: Computation): MetricDefinition<Label, Definition, Computation> {
  return fieldsInOrder([
    ['label', label],
    ['definition', definition],
    ['computation', computation],
  ])
}

// React port of the original dashboard's exhaustive metric help map.
const definitions = [
  [
    'lead-time',
    metricDefinition(
      'Lead time',
      'How long an issue waits from becoming ready to work through to done.',
      'Lead time = done − ready, for issues completed in the window.',
    ),
  ],
  [
    'cycle-time',
    metricDefinition(
      'Cycle time',
      'How long active work on an issue takes, once someone starts it.',
      'Cycle time = done − claimed, for issues completed in the window.',
    ),
  ],
  [
    'wip',
    metricDefinition(
      'WIP over time',
      'How many issues are actively in progress at once, across the window.',
      'Count of issues in the in_progress status, sampled daily.',
    ),
  ],
  [
    'throughput',
    metricDefinition(
      'Throughput',
      'How many issues the factory finishes per bucket.',
      'Count of issues reaching done per bucket (day or week).',
    ),
  ],
  [
    'bug-share',
    metricDefinition(
      'Bug share',
      'What fraction of completed work each bucket was bug fixes, not new work.',
      'Bug share = bug-typed issues completed ÷ all issues completed, per bucket. Buckets with no completions are gapped, not zero.',
    ),
  ],
  [
    'review-latency',
    metricDefinition(
      'Review latency',
      'How long an issue sits in review before a human signs off.',
      'Review latency = done − entered review, for issues completed in the window.',
    ),
  ],
  [
    'human-interventions',
    metricDefinition(
      'Human interventions',
      'How much direct human attention a completed issue needed.',
      'Count of human-authored comments plus status bounces (review → in progress), per completed issue.',
    ),
  ],
  [
    'autonomy-ratio',
    metricDefinition(
      'Autonomy ratio',
      "What share of a completed issue's cycle time an agent held the work unattended.",
      'Autonomy ratio = lease-held time ÷ total cycle time, per completed issue.',
    ),
  ],
  [
    'cumulative-flow',
    metricDefinition(
      'Cumulative flow',
      'How many issues sit in each status category over time. A widening band shows where work is backing up.',
      'Stacked counts of issues in backlog/todo, in progress, in review, and done, sampled per bucket.',
    ),
  ],
  [
    'time-in-progress',
    metricDefinition(
      'Time in progress',
      'How long an issue spends being actively worked, before review.',
      'Time in progress = entered review (or done, if review was skipped) − claimed, for issues completed in the window.',
    ),
  ],
  [
    'arrival-vs-completion',
    metricDefinition(
      'Arrival vs completion',
      'Whether the backlog is growing or shrinking, bucket by bucket.',
      'Net = issues created − issues completed, per bucket. A positive net means the backlog is growing.',
    ),
  ],
  [
    'flow-efficiency',
    metricDefinition(
      'Flow efficiency',
      "What share of an issue's total time from ready to done was actual agent work, versus waiting.",
      'Flow efficiency = lease-held time ÷ lead time (ready → done), for issues completed in the window.',
    ),
  ],
  [
    'aging-wip',
    metricDefinition(
      'Aging WIP',
      'How long issues that are still open have already been in progress or review. Stuck work shows up here before it finishes.',
      "Age since claim for every currently open in_progress/in_review issue, plotted against this window's cycle-time p50/p90.",
    ),
  ],
  [
    'lease-expiries',
    metricDefinition(
      'Lease expiries',
      'How often an agent died mid-work and its claim on an issue had to be reclaimed.',
      'Count of issue leases reclaimed because the holding agent stopped heartbeating, in the window.',
    ),
  ],
  [
    'abandoned-claims',
    metricDefinition(
      'Abandoned claims',
      "How often a file claim was released because an agent's session ended, not deliberately.",
      'Count of file claims released by session end (not explicit release), in the window.',
    ),
  ],
  [
    'gate-rejections',
    metricDefinition(
      'Gate rejections',
      'How often review sent work back for rework instead of approving it.',
      'Count of issues moved from in review back to in progress, in the window.',
    ),
  ],
  [
    'wip-cap-pressure',
    metricDefinition(
      'WIP-cap pressure',
      "How often a claim was denied because the project's agent WIP cap was already full.",
      "Count of claim_issue calls rejected for exceeding the project's agent WIP limit, in the window.",
    ),
  ],
  [
    'code-heatmap',
    metricDefinition(
      'Where work lands',
      'Which parts of the codebase are seeing the most work, by file claims.',
      'Directories/paths sized by distinct issues that claimed files there, from file-claim history in the window.',
    ),
  ],
  [
    'code-heatmap-contention',
    metricDefinition(
      'Where the fleet queues up',
      'Which parts of the codebase cause agents to collide over file claims, blocking parallelism.',
      'Directories/paths sized by distinct issues whose claim_files attempt was rejected or overridden there, in the window.',
    ),
  ],
] as const
export const METRIC_DEFINITIONS: Readonly<FieldsInOrder<typeof definitions>> = fieldsInOrder(definitions)
export type MetricId = keyof typeof METRIC_DEFINITIONS
