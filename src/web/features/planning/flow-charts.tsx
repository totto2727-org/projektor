'use client'
import { Predicate } from 'effect'
import { useCallback, useId, useMemo } from 'react'
import type { JSX, ComponentProps, ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  Scatter,
  XAxis,
  YAxis,
} from 'recharts'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { formatUtcDatePrefix } from '#contracts/time.ts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/generated/chart.tsx'
import type { ChartConfig } from '@/components/generated/chart.tsx'

import { formatDuration, formatPercent } from './helpers.ts'
import type { FlowMetrics } from './types.ts'

const EMPTY_COUNT = 0
const MIN_FRACTION = 0
const MAX_FRACTION = 1
const HASH_MULTIPLIER = 31
const UNSIGNED_SHIFT_BITS = 0
const JITTER_STEPS = 1000
const IN_PROGRESS_COLUMN = 0
const IN_REVIEW_COLUMN = 1
const JITTER_MIDPOINT = 0.5
const JITTER_WIDTH = 0.5
const MIN_STATUS_AXIS = -0.5
const MAX_STATUS_AXIS = 1.5
const MIN_AGE_SECONDS = 0
const EMPTY_AXIS_MAX_SECONDS = 1
const AGE_AXIS_HEADROOM = 1.1

const fractionAxisDomain: [number, number] = [MIN_FRACTION, MAX_FRACTION]
const wipTimeDomain: ['dataMin', 'dataMax'] = ['dataMin', 'dataMax']
const agingStatusDomain: [number, number] = [MIN_STATUS_AXIS, MAX_STATUS_AXIS]
const agingStatusTicks = [IN_PROGRESS_COLUMN, IN_REVIEW_COLUMN]
const seriesDot = { r: 3 }

export const formatShortDate = function formatShortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(
        'en-US',
        fieldsInOrder([
          ['month', 'short'],
          ['day', 'numeric'],
          ['timeZone', 'UTC'],
        ]),
      )
}
export const formatFullDate = function formatFullDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(
        'en-US',
        fieldsInOrder([
          ['month', 'short'],
          ['day', 'numeric'],
          ['year', 'numeric'],
          ['timeZone', 'UTC'],
        ]),
      )
}
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const EmptyChartState = function EmptyChartState({ message }: { message: string }): JSX.Element {
  return <div className='flex items-center justify-center h-[220px] text-sm text-text-muted'>{message}</div>
}
const accent = 'var(--accent)'
const muted = 'var(--text-muted)'
const sequential = {
  backlogTodo: 'var(--chart-seq-1)',
  done: 'var(--chart-seq-4)',
  inProgress: 'var(--chart-seq-2)',
  inReview: 'var(--chart-seq-3)',
}
const CHART_MARGIN_GUTTER = 12
const CHART_MARGIN_FLUSH = 0
const margin = fieldsInOrder([
  ['top', CHART_MARGIN_GUTTER],
  ['right', CHART_MARGIN_GUTTER],
  ['bottom', CHART_MARGIN_FLUSH],
  ['left', CHART_MARGIN_FLUSH],
])

const chartSeries = function chartSeries(label: string, color: string): { label: string; color: string } {
  return fieldsInOrder([
    ['label', label],
    ['color', color],
  ])
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const FlowChart = function FlowChart({
  name,
  config,
  children,
}: {
  name: string
  config: ChartConfig
  children: ReactNode
}): JSX.Element {
  const id = useId()
  return (
    <ChartContainer
      id={`flow-${name}-${id.replaceAll(/[^a-zA-Z0-9_-]/gu, '')}`}
      config={config}
      className='h-[220px] min-h-[220px] w-full aspect-auto'
      data-testid={`flow-chart-${name}`}
    >
      {children}
    </ChartContainer>
  )
}
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const DateAxis = function DateAxis(): JSX.Element {
  return (
    <XAxis dataKey='bucketStart' tickFormatter={formatShortDate} tickLine={false} axisLine={false} minTickGap={24} />
  )
}
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const CountAxis = function CountAxis(): JSX.Element {
  return <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={42} />
}
const valueFormatter = function valueFormatter(
  config: ChartConfig,
  formatValue: (value: number) => string,
  onlyDataKey?: string,
): ComponentProps<typeof ChartTooltipContent>['formatter'] {
  // oxlint-disable-next-line react/function-component-definition -- Recharts uses this callback for tooltip formatting. eslint/func-style requires an expression.
  return (value, name, item) =>
    Predicate.isNotNullish(onlyDataKey) && item.dataKey !== onlyDataKey ? null : (
      <div className='flex flex-1 items-center justify-between gap-3'>
        <span className='text-muted-foreground'>{config[String(item.dataKey ?? name)]?.label ?? name}</span>
        <span className='font-mono font-medium tabular-nums'>
          {Predicate.isNumber(value) ? formatValue(value) : String(value)}
        </span>
      </div>
    )
}
const formatTooltipDate = function formatTooltipDate(label: unknown): string {
  return formatFullDate(String(label))
}

const formatCompletedCount = function formatCompletedCount(value: number): string {
  return `${value} completed`
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const DateTooltip = function DateTooltip({
  config,
  formatValue,
}: {
  config?: ChartConfig
  formatValue?: (value: number) => string
}): JSX.Element {
  const content = useMemo(
    () => (
      <ChartTooltipContent
        labelFormatter={formatTooltipDate}
        formatter={formatValue ? valueFormatter(config ?? {}, formatValue) : undefined}
      />
    ),
    [config, formatValue],
  )
  return <ChartTooltip content={content} />
}
const throughputConfig = { count: chartSeries('Issues completed', accent) } satisfies ChartConfig
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const ThroughputChart = function ThroughputChart({
  data,
}: {
  data: Readonly<FlowMetrics['throughputOverTime'][number][]>
}): JSX.Element {
  if (!data.length || data.every((point) => point.count === EMPTY_COUNT)) {
    return <EmptyChartState message='No completed issues yet' />
  }
  return (
    <FlowChart name='throughput' config={throughputConfig}>
      <BarChart accessibilityLayer data={data} margin={margin}>
        <CartesianGrid vertical={false} />
        <DateAxis />
        <CountAxis />
        <DateTooltip config={throughputConfig} formatValue={formatCompletedCount} />
        <Bar
          dataKey='count'
          fill='var(--color-count)'
          fillOpacity={0.25}
          stroke='var(--color-count)'
          isAnimationActive={false}
        />
      </BarChart>
    </FlowChart>
  )
}
type LegendRenderer = Extract<
  NonNullable<ComponentProps<typeof ChartLegend>['content']>,
  (...args: never[]) => ReactNode
>

const cfdConfig = fieldsInOrder([
  ['backlogTodo', chartSeries('Backlog/todo', sequential.backlogTodo)],
  ['inProgress', chartSeries('In progress', sequential.inProgress)],
  ['inReview', chartSeries('In review', sequential.inReview)],
  ['done', chartSeries('Done', sequential.done)],
]) satisfies ChartConfig
// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function CfdChart({ data }: { data: Readonly<FlowMetrics['cfdOverTime'][number][]> }): JSX.Element {
  const renderLegend = useCallback<LegendRenderer>(
    ({ payload }): JSX.Element => (
      <ChartLegendContent
        payload={payload?.toSorted(
          (left, right) =>
            Object.keys(cfdConfig).indexOf(String(left.dataKey)) -
            Object.keys(cfdConfig).indexOf(String(right.dataKey)),
        )}
        className='flex-wrap gap-x-3 gap-y-1 text-[10px]'
      />
    ),
    [],
  )
  if (
    !data.length ||
    data.every((point) => point.backlogTodo + point.inProgress + point.inReview + point.done === EMPTY_COUNT)
  ) {
    return <EmptyChartState message='No issues in this window yet' />
  }
  // Recharts stacks raw state counts. Supplying cumulative totals here would double-stack the CFD.
  return (
    <FlowChart name='cfd' config={cfdConfig}>
      <AreaChart accessibilityLayer data={data} margin={margin}>
        <CartesianGrid vertical={false} />
        <DateAxis />
        <CountAxis />
        <DateTooltip />
        <ChartLegend content={renderLegend} />
        {(['done', 'inReview', 'inProgress', 'backlogTodo'] as const).map((key) => (
          <Area
            key={key}
            dataKey={key}
            type='linear'
            stackId='states'
            stroke={`var(--color-${key})`}
            fill={`var(--color-${key})`}
            fillOpacity={1}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </FlowChart>
  )
}
const bugConfig = { bugSharePercent: chartSeries('Bug share', accent) } satisfies ChartConfig
// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function BugShareChart({
  data,
  bugTypeTracked,
}: {
  data: FlowMetrics['bugShareOverTime']
  bugTypeTracked: boolean
}): JSX.Element {
  if (!bugTypeTracked) {
    return <EmptyChartState message='Not tracked: no task type keyed "bug" exists in this workspace' />
  }
  if (!data.length || data.every((point) => Predicate.isNullish(point.bugSharePercent))) {
    return <EmptyChartState message='No completed issues yet' />
  }
  return (
    <FlowChart name='bug-share' config={bugConfig}>
      <LineChart accessibilityLayer data={data} margin={margin}>
        <CartesianGrid vertical={false} />
        <DateAxis />
        <YAxis domain={fractionAxisDomain} tickFormatter={formatPercent} tickLine={false} axisLine={false} width={42} />
        <DateTooltip config={bugConfig} formatValue={formatPercent} />
        <Line
          dataKey='bugSharePercent'
          type='linear'
          connectNulls={false}
          stroke='var(--color-bugSharePercent)'
          strokeWidth={2}
          dot={seriesDot}
          isAnimationActive={false}
        />
      </LineChart>
    </FlowChart>
  )
}
const reviewConfig = { p50: chartSeries('Review latency (p50)', accent) } satisfies ChartConfig
// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function ReviewLatencyChart({ data }: { data: FlowMetrics['reviewLatencyOverTime'] }): JSX.Element {
  if (!data.length || data.every((point) => Predicate.isNullish(point.p50))) {
    return <EmptyChartState message='No review-latency data yet' />
  }
  return (
    <FlowChart name='review-latency' config={reviewConfig}>
      <LineChart accessibilityLayer data={data} margin={margin}>
        <CartesianGrid vertical={false} />
        <DateAxis />
        <YAxis tickFormatter={formatDuration} tickLine={false} axisLine={false} width={52} />
        <DateTooltip config={reviewConfig} formatValue={formatDuration} />
        <Line
          dataKey='p50'
          type='linear'
          connectNulls={false}
          stroke='var(--color-p50)'
          strokeWidth={2}
          dot={seriesDot}
          isAnimationActive={false}
        />
      </LineChart>
    </FlowChart>
  )
}
const wipConfig = { count: chartSeries('WIP', accent) } satisfies ChartConfig
const timestampDate = (value: number): string => formatUtcDatePrefix(new Date(value))

const formatWipTick = function formatWipTick(value: number): string {
  return formatShortDate(timestampDate(value))
}

const formatWipTooltipDate: NonNullable<ComponentProps<typeof ChartTooltipContent>['labelFormatter']> =
  function formatWipTooltipDate(_label, payload): string {
    const date: unknown = payload[0]?.payload?.date
    return Predicate.isString(date) ? formatFullDate(date) : ''
  }

const wipTooltip = (
  <ChartTooltipContent
    labelFormatter={formatWipTooltipDate}
    formatter={valueFormatter(wipConfig, (value) => `${value} in progress`)}
  />
)

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function WipChart({ data }: { data: FlowMetrics['wipOverTime'] }): JSX.Element {
  const points = useMemo(() => data.map((point) => ({ ...point, timestamp: new Date(point.date).getTime() })), [data])
  if (!data.length || data.every((point) => point.count === EMPTY_COUNT)) {
    return <EmptyChartState message='No WIP data yet' />
  }
  return (
    <FlowChart name='wip' config={wipConfig}>
      <LineChart accessibilityLayer data={points} margin={margin}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey='timestamp'
          type='number'
          scale='time'
          domain={wipTimeDomain}
          tickFormatter={formatWipTick}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <CountAxis />
        <ChartTooltip content={wipTooltip} />
        <Line
          dataKey='count'
          type='linear'
          stroke='var(--color-count)'
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </FlowChart>
  )
}
const arrivalConfig = fieldsInOrder([
  ['created', chartSeries('Created', 'var(--chart-secondary)')],
  ['completed', chartSeries('Completed', accent)],
  ['net', chartSeries('Net (created − completed)', muted)],
]) satisfies ChartConfig
const arrivalLegend = <ChartLegendContent className='flex-wrap gap-x-3 gap-y-1 text-[10px]' />

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function ArrivalVsCompletionChart({ data }: { data: FlowMetrics['arrivalVsCompletionOverTime'] }): JSX.Element {
  if (!data.length || data.every((point) => point.created === EMPTY_COUNT && point.completed === EMPTY_COUNT)) {
    return <EmptyChartState message='No arrivals or completions yet' />
  }
  return (
    <FlowChart name='arrival-completion' config={arrivalConfig}>
      <LineChart accessibilityLayer data={data} margin={margin}>
        <CartesianGrid vertical={false} />
        <DateAxis />
        <CountAxis />
        <DateTooltip />
        <ChartLegend content={arrivalLegend} />
        <Line
          dataKey='created'
          type='linear'
          stroke='var(--color-created)'
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey='completed'
          type='linear'
          stroke='var(--color-completed)'
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey='net'
          type='linear'
          stroke='var(--color-net)'
          strokeWidth={1}
          strokeDasharray='4 4'
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </FlowChart>
  )
}
export function hashJitter(id: string): number {
  let hash = 0
  for (let index = 0; index < id.length; index++) {
    hash = Math.imul(hash, HASH_MULTIPLIER) + id.charCodeAt(index)
  }
  return ((hash >>> UNSIGNED_SHIFT_BITS) % JITTER_STEPS) / JITTER_STEPS
}
const agingConfig = {
  ageSeconds: chartSeries('Age since claim', sequential.inProgress),
  p50: chartSeries('p50 cycle time', muted),
  p90: chartSeries('p90 cycle time', muted),
} satisfies ChartConfig
interface AgingLegendEntry {
  value: string
  dataKey: string
  type: 'circle' | 'line'
  color: string
}

const agingLegendEntry = function agingLegendEntry(
  metric: keyof typeof agingConfig,
  type: AgingLegendEntry['type'],
  color: string,
): AgingLegendEntry {
  return fieldsInOrder([
    ['value', metric],
    ['dataKey', metric],
    ['type', type],
    ['color', color],
  ])
}

const ageLegend = agingLegendEntry('ageSeconds', 'circle', sequential.inProgress)
const p50Legend = agingLegendEntry('p50', 'line', muted)
const p90Legend = agingLegendEntry('p90', 'line', muted)

const GUIDE_LABEL_FONT_SIZE = 10
const p50GuideLabel = fieldsInOrder([
  ['value', 'p50 cycle time'],
  ['position', 'insideTopRight'],
  ['fill', muted],
  ['fontSize', GUIDE_LABEL_FONT_SIZE],
])
const p90GuideLabel = fieldsInOrder([
  ['value', 'p90 cycle time'],
  ['position', 'insideTopRight'],
  ['fill', muted],
  ['fontSize', GUIDE_LABEL_FONT_SIZE],
])

const formatAgingStatus = function formatAgingStatus(value: number): string {
  return value === IN_PROGRESS_COLUMN ? 'In progress' : 'In review'
}

const agingTooltip = (
  <ChartTooltipContent hideLabel formatter={valueFormatter(agingConfig, formatDuration, 'ageSeconds')} />
)

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function AgingWipScatter({
  data,
  p50,
  p90,
}: {
  data: FlowMetrics['agingWip']
  p50: number | null
  p90: number | null
}): JSX.Element {
  const points = useMemo(
    () =>
      data
        .map((point) => ({
          ...point,
          x:
            (point.status === 'in_progress' ? IN_PROGRESS_COLUMN : IN_REVIEW_COLUMN) +
            (hashJitter(point.id) - JITTER_MIDPOINT) * JITTER_WIDTH,
        }))
        .toSorted((left, right) => left.x - right.x),
    [data],
  )
  const hasP50 = Predicate.isNotNullish(p50)
  const hasP90 = Predicate.isNotNullish(p90)
  const legendPayload = useMemo(
    () => [ageLegend, ...(hasP50 ? [p50Legend] : []), ...(hasP90 ? [p90Legend] : [])],
    [hasP50, hasP90],
  )
  const renderLegend = useCallback(
    (): JSX.Element => <ChartLegendContent className='flex-wrap gap-x-3 gap-y-1 text-[10px]' payload={legendPayload} />,
    [legendPayload],
  )
  const maxAge = Math.max(
    MIN_AGE_SECONDS,
    ...data.map((point) => point.ageSeconds),
    p50 ?? MIN_AGE_SECONDS,
    p90 ?? MIN_AGE_SECONDS,
  )
  const ageDomain = useMemo<[number, number]>(
    () => [MIN_AGE_SECONDS, maxAge === MIN_AGE_SECONDS ? EMPTY_AXIS_MAX_SECONDS : maxAge * AGE_AXIS_HEADROOM],
    [maxAge],
  )
  if (!data.length) {
    return <EmptyChartState message='No issues currently in progress or review' />
  }
  return (
    <FlowChart name='aging-wip' config={agingConfig}>
      <ComposedChart accessibilityLayer data={points} margin={margin}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey='x'
          type='number'
          domain={agingStatusDomain}
          ticks={agingStatusTicks}
          tickFormatter={formatAgingStatus}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          dataKey='ageSeconds'
          type='number'
          domain={ageDomain}
          tickFormatter={formatDuration}
          tickLine={false}
          axisLine={false}
          width={52}
        />
        <ChartTooltip content={agingTooltip} />
        <ChartLegend content={renderLegend} />
        <Scatter dataKey='ageSeconds' name='ageSeconds' fill='var(--color-ageSeconds)' isAnimationActive={false} />
        {hasP50 && <ReferenceLine y={p50} stroke='var(--color-p50)' strokeDasharray='4 4' label={p50GuideLabel} />}
        {hasP90 && <ReferenceLine y={p90} stroke='var(--color-p90)' strokeDasharray='2 2' label={p90GuideLabel} />}
      </ComposedChart>
    </FlowChart>
  )
}
