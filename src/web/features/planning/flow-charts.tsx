'use client'
import { Predicate } from 'effect'
import { useId, useMemo } from 'react'
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

export const formatShortDate = function formatShortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
export const formatFullDate = function formatFullDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
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
const margin = { top: 12, right: 12, bottom: 0, left: 0 }

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
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const DateTooltip = function DateTooltip({
  config,
  formatValue,
}: {
  config?: ChartConfig
  formatValue?: (value: number) => string
}): JSX.Element {
  return (
    <ChartTooltip
      content={
        <ChartTooltipContent
          labelFormatter={(label) => formatFullDate(String(label))}
          formatter={formatValue ? valueFormatter(config ?? {}, formatValue) : undefined}
        />
      }
    />
  )
}
const throughputConfig = { count: { label: 'Issues completed', color: accent } } satisfies ChartConfig
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
        <DateTooltip config={throughputConfig} formatValue={(value) => `${value} completed`} />
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
const cfdConfig = {
  backlogTodo: { label: 'Backlog/todo', color: sequential.backlogTodo },
  inProgress: { label: 'In progress', color: sequential.inProgress },
  inReview: { label: 'In review', color: sequential.inReview },
  done: { label: 'Done', color: sequential.done },
} satisfies ChartConfig
// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function CfdChart({ data }: { data: Readonly<FlowMetrics['cfdOverTime'][number][]> }): JSX.Element {
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
        <ChartLegend
          content={({ payload }) => (
            <ChartLegendContent
              payload={payload?.toSorted(
                (left, right) =>
                  Object.keys(cfdConfig).indexOf(String(left.dataKey)) -
                  Object.keys(cfdConfig).indexOf(String(right.dataKey)),
              )}
              className='flex-wrap gap-x-3 gap-y-1 text-[10px]'
            />
          )}
        />
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
const bugConfig = { bugSharePercent: { label: 'Bug share', color: accent } } satisfies ChartConfig
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
        <YAxis
          domain={[MIN_FRACTION, MAX_FRACTION]}
          tickFormatter={formatPercent}
          tickLine={false}
          axisLine={false}
          width={42}
        />
        <DateTooltip config={bugConfig} formatValue={formatPercent} />
        <Line
          dataKey='bugSharePercent'
          type='linear'
          connectNulls={false}
          stroke='var(--color-bugSharePercent)'
          strokeWidth={2}
          dot={{ r: 3 }}
          isAnimationActive={false}
        />
      </LineChart>
    </FlowChart>
  )
}
const reviewConfig = { p50: { label: 'Review latency (p50)', color: accent } } satisfies ChartConfig
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
          dot={{ r: 3 }}
          isAnimationActive={false}
        />
      </LineChart>
    </FlowChart>
  )
}
const wipConfig = { count: { label: 'WIP', color: accent } } satisfies ChartConfig
const timestampDate = (value: number): string => formatUtcDatePrefix(new Date(value))
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
          domain={['dataMin', 'dataMax']}
          tickFormatter={(value: number) => formatShortDate(timestampDate(value))}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <CountAxis />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_label, payload) => {
                const date: unknown = payload[0]?.payload?.date
                return Predicate.isString(date) ? formatFullDate(date) : ''
              }}
              formatter={valueFormatter(wipConfig, (value) => `${value} in progress`)}
            />
          }
        />
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
const arrivalConfig = {
  created: { label: 'Created', color: 'var(--chart-secondary)' },
  completed: { label: 'Completed', color: accent },
  net: { label: 'Net (created − completed)', color: muted },
} satisfies ChartConfig
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
        <ChartLegend content={<ChartLegendContent className='flex-wrap gap-x-3 gap-y-1 text-[10px]' />} />
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
  ageSeconds: { label: 'Age since claim', color: sequential.inProgress },
  p50: { label: 'p50 cycle time', color: muted },
  p90: { label: 'p90 cycle time', color: muted },
} satisfies ChartConfig
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
  const maxAge = Math.max(
    MIN_AGE_SECONDS,
    ...data.map((point) => point.ageSeconds),
    p50 ?? MIN_AGE_SECONDS,
    p90 ?? MIN_AGE_SECONDS,
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
          domain={[MIN_STATUS_AXIS, MAX_STATUS_AXIS]}
          ticks={[IN_PROGRESS_COLUMN, IN_REVIEW_COLUMN]}
          tickFormatter={(value: number) => (value === IN_PROGRESS_COLUMN ? 'In progress' : 'In review')}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          dataKey='ageSeconds'
          type='number'
          domain={[MIN_AGE_SECONDS, maxAge === MIN_AGE_SECONDS ? EMPTY_AXIS_MAX_SECONDS : maxAge * AGE_AXIS_HEADROOM]}
          tickFormatter={formatDuration}
          tickLine={false}
          axisLine={false}
          width={52}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent hideLabel formatter={valueFormatter(agingConfig, formatDuration, 'ageSeconds')} />
          }
        />
        <ChartLegend
          content={() => (
            <ChartLegendContent
              className='flex-wrap gap-x-3 gap-y-1 text-[10px]'
              payload={[
                { value: 'ageSeconds', dataKey: 'ageSeconds', type: 'circle', color: sequential.inProgress },
                ...(Predicate.isNullish(p50)
                  ? []
                  : [{ value: 'p50', dataKey: 'p50', type: 'line' as const, color: muted }]),
                ...(Predicate.isNullish(p90)
                  ? []
                  : [{ value: 'p90', dataKey: 'p90', type: 'line' as const, color: muted }]),
              ]}
            />
          )}
        />
        <Scatter dataKey='ageSeconds' name='ageSeconds' fill='var(--color-ageSeconds)' isAnimationActive={false} />
        {Predicate.isNotNullish(p50) && (
          <ReferenceLine
            y={p50}
            stroke='var(--color-p50)'
            strokeDasharray='4 4'
            label={{ value: 'p50 cycle time', position: 'insideTopRight', fill: muted, fontSize: 10 }}
          />
        )}
        {Predicate.isNotNullish(p90) && (
          <ReferenceLine
            y={p90}
            stroke='var(--color-p90)'
            strokeDasharray='2 2'
            label={{ value: 'p90 cycle time', position: 'insideTopRight', fill: muted, fontSize: 10 }}
          />
        )}
      </ComposedChart>
    </FlowChart>
  )
}
