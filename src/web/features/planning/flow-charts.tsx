'use client'

import { useId, useMemo } from 'react'
import type { ComponentProps, ReactNode } from 'react'
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

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '../../components/generated/chart'
import type { ChartConfig } from '../../components/generated/chart'
import { formatDuration, formatPercent } from './helpers'
import type { FlowMetrics } from './types'

export function formatShortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
export function formatFullDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
export function EmptyChartState({ message }: { message: string }) {
  return <div className='flex items-center justify-center h-[220px] text-sm text-text-muted'>{message}</div>
}
const accent = 'var(--accent)'
const muted = 'var(--text-muted)'
const sequential = {
  backlogTodo: 'var(--chart-seq-1)',
  inProgress: 'var(--chart-seq-2)',
  inReview: 'var(--chart-seq-3)',
  done: 'var(--chart-seq-4)',
}
const margin = { top: 12, right: 12, bottom: 0, left: 0 }

function FlowChart({ name, config, children }: { name: string; config: ChartConfig; children: ReactNode }) {
  const id = useId()
  return (
    <ChartContainer
      id={`flow-${name}-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`}
      config={config}
      className='h-[220px] min-h-[220px] w-full aspect-auto'
      data-testid={`flow-chart-${name}`}
    >
      {children}
    </ChartContainer>
  )
}
function DateAxis() {
  return (
    <XAxis dataKey='bucketStart' tickFormatter={formatShortDate} tickLine={false} axisLine={false} minTickGap={24} />
  )
}
function CountAxis() {
  return <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={42} />
}
function valueFormatter(
  config: ChartConfig,
  formatValue: (value: number) => string,
  onlyDataKey?: string,
): ComponentProps<typeof ChartTooltipContent>['formatter'] {
  return (value, name, item) =>
    onlyDataKey !== undefined && item.dataKey !== onlyDataKey ? null : (
      <div className='flex flex-1 items-center justify-between gap-3'>
        <span className='text-muted-foreground'>{config[String(item.dataKey ?? name)]?.label ?? name}</span>
        <span className='font-mono font-medium tabular-nums'>
          {typeof value === 'number' ? formatValue(value) : String(value)}
        </span>
      </div>
    )
}
function DateTooltip({ config, formatValue }: { config?: ChartConfig; formatValue?: (value: number) => string }) {
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
export function ThroughputChart({ data }: { data: ReadonlyArray<FlowMetrics['throughputOverTime'][number]> }) {
  if (!data.length || data.every((point) => point.count === 0))
    return <EmptyChartState message='No completed issues yet' />
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
export function CfdChart({ data }: { data: ReadonlyArray<FlowMetrics['cfdOverTime'][number]> }) {
  if (!data.length || data.every((point) => point.backlogTodo + point.inProgress + point.inReview + point.done === 0))
    return <EmptyChartState message='No issues in this window yet' />
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
                (a, b) =>
                  Object.keys(cfdConfig).indexOf(String(a.dataKey)) - Object.keys(cfdConfig).indexOf(String(b.dataKey)),
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
export function BugShareChart({
  data,
  bugTypeTracked,
}: {
  data: FlowMetrics['bugShareOverTime']
  bugTypeTracked: boolean
}) {
  if (!bugTypeTracked)
    return <EmptyChartState message={'Not tracked: no task type keyed "bug" exists in this workspace'} />
  if (!data.length || data.every((point) => point.bugSharePercent === null))
    return <EmptyChartState message='No completed issues yet' />
  return (
    <FlowChart name='bug-share' config={bugConfig}>
      <LineChart accessibilityLayer data={data} margin={margin}>
        <CartesianGrid vertical={false} />
        <DateAxis />
        <YAxis domain={[0, 1]} tickFormatter={formatPercent} tickLine={false} axisLine={false} width={42} />
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
export function ReviewLatencyChart({ data }: { data: FlowMetrics['reviewLatencyOverTime'] }) {
  if (!data.length || data.every((point) => point.p50 === null))
    return <EmptyChartState message='No review-latency data yet' />
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
const timestampDate = (value: number) => new Date(value).toISOString().slice(0, 10)
export function WipChart({ data }: { data: FlowMetrics['wipOverTime'] }) {
  const points = useMemo(() => data.map((point) => ({ ...point, timestamp: new Date(point.date).getTime() })), [data])
  if (!data.length || data.every((point) => point.count === 0)) return <EmptyChartState message='No WIP data yet' />
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
                return typeof date === 'string' ? formatFullDate(date) : ''
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
export function ArrivalVsCompletionChart({ data }: { data: FlowMetrics['arrivalVsCompletionOverTime'] }) {
  if (!data.length || data.every((point) => point.created === 0 && point.completed === 0))
    return <EmptyChartState message='No arrivals or completions yet' />
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
  for (let index = 0; index < id.length; index++) hash = (hash * 31 + id.charCodeAt(index)) | 0
  return ((hash >>> 0) % 1000) / 1000
}
const agingConfig = {
  ageSeconds: { label: 'Age since claim', color: sequential.inProgress },
  p50: { label: 'p50 cycle time', color: muted },
  p90: { label: 'p90 cycle time', color: muted },
} satisfies ChartConfig
export function AgingWipScatter({
  data,
  p50,
  p90,
}: {
  data: FlowMetrics['agingWip']
  p50: number | null
  p90: number | null
}) {
  const points = useMemo(
    () =>
      data
        .map((point) => ({
          ...point,
          x: (point.status === 'in_progress' ? 0 : 1) + (hashJitter(point.id) - 0.5) * 0.5,
        }))
        .sort((a, b) => a.x - b.x),
    [data],
  )
  const maxAge = Math.max(0, ...data.map((point) => point.ageSeconds), p50 ?? 0, p90 ?? 0)
  if (!data.length) return <EmptyChartState message='No issues currently in progress or review' />
  return (
    <FlowChart name='aging-wip' config={agingConfig}>
      <ComposedChart accessibilityLayer data={points} margin={margin}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey='x'
          type='number'
          domain={[-0.5, 1.5]}
          ticks={[0, 1]}
          tickFormatter={(value: number) => (value === 0 ? 'In progress' : 'In review')}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          dataKey='ageSeconds'
          type='number'
          domain={[0, maxAge === 0 ? 1 : maxAge * 1.1]}
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
                ...(p50 === null ? [] : [{ value: 'p50', dataKey: 'p50', type: 'line' as const, color: muted }]),
                ...(p90 === null ? [] : [{ value: 'p90', dataKey: 'p90', type: 'line' as const, color: muted }]),
              ]}
            />
          )}
        />
        <Scatter dataKey='ageSeconds' name='ageSeconds' fill='var(--color-ageSeconds)' isAnimationActive={false} />
        {p50 !== null && (
          <ReferenceLine
            y={p50}
            stroke='var(--color-p50)'
            strokeDasharray='4 4'
            label={{ value: 'p50 cycle time', position: 'insideTopRight', fill: muted, fontSize: 10 }}
          />
        )}
        {p90 !== null && (
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
