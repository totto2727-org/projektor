'use client'

import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'

import type { FlowMetrics } from './schemas'

const WIDTH = 620
const HEIGHT = 220
const PADDING = { top: 18, right: 16, bottom: 38, left: 36 }

function shortDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function chartFrame(children: ReactNode, label: string, empty: boolean, emptyMessage: string) {
  return (
    <div className='p-4 bg-surface border border-border rounded-lg overflow-x-auto'>
      <p className='m-0 mb-2 text-[0.72rem] font-medium text-text-muted'>{label}</p>
      {empty ? (
        <div className='flex items-center justify-center h-[220px] text-sm text-text-muted'>{emptyMessage}</div>
      ) : (
        children
      )}
    </div>
  )
}

function Axis({ labels, max }: { labels: readonly string[]; max: number }) {
  const chartWidth = WIDTH - PADDING.left - PADDING.right
  const chartHeight = HEIGHT - PADDING.top - PADDING.bottom
  const indices =
    labels.length <= 2
      ? labels.map((_, index) => index)
      : Array.from({ length: Math.min(labels.length, 6) }, (_, index) =>
          Math.round((index * (labels.length - 1)) / Math.min(labels.length - 1, 5)),
        )
  return (
    <>
      {[0, 0.5, 1].map((fraction) => (
        <g key={fraction}>
          <line
            x1={PADDING.left}
            x2={WIDTH - PADDING.right}
            y1={PADDING.top + chartHeight * (1 - fraction)}
            y2={PADDING.top + chartHeight * (1 - fraction)}
            stroke='var(--border)'
          />
          <text
            x={PADDING.left - 6}
            y={PADDING.top + chartHeight * (1 - fraction) + 4}
            textAnchor='end'
            fill='var(--text-muted)'
            fontSize='10'
          >
            {Math.round(max * fraction)}
          </text>
        </g>
      ))}
      {indices.map((index) => (
        <text
          key={index}
          x={PADDING.left + (labels.length <= 1 ? chartWidth / 2 : (chartWidth * index) / (labels.length - 1))}
          y={HEIGHT - 10}
          textAnchor='middle'
          fill='var(--text-muted)'
          fontSize='10'
        >
          {shortDate(labels[index])}
        </text>
      ))}
    </>
  )
}

function ThroughputChart({ data }: { data: FlowMetrics['throughputOverTime'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((point) => point.count))
  const labels = data.map((point) => point.bucketStart)
  const width = (WIDTH - PADDING.left - PADDING.right) / Math.max(data.length, 1)
  return chartFrame(
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className='w-full min-w-[320px] h-[220px]'
      role='img'
      aria-label='Completed issues by week'
    >
      <Axis labels={labels} max={max} />
      {data.map((point, index) => {
        const height = ((HEIGHT - PADDING.top - PADDING.bottom) * point.count) / max
        const x = PADDING.left + index * width + width * 0.15
        const y = HEIGHT - PADDING.bottom - height
        return (
          <g key={point.bucketStart} onPointerEnter={() => setHover(index)} onPointerLeave={() => setHover(null)}>
            <rect x={x} y={y} width={width * 0.7} height={height} rx='2' fill='var(--accent)' />
            <title>{`${shortDate(point.bucketStart)}: ${point.count} completed`}</title>
            {hover === index && (
              <text x={x + width * 0.35} y={Math.max(12, y - 5)} textAnchor='middle' fill='var(--text)' fontSize='11'>
                {point.count} completed
              </text>
            )}
          </g>
        )
      })}
    </svg>,
    'Throughput',
    data.length === 0 || data.every((point) => point.count === 0),
    'No completed issues yet',
  )
}

function CfdChart({ data }: { data: FlowMetrics['cfdOverTime'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const totals = data.map((point) => point.backlogTodo + point.inProgress + point.inReview + point.done)
  const max = Math.max(1, ...totals)
  const labels = data.map((point) => point.bucketStart)
  const innerWidth = WIDTH - PADDING.left - PADDING.right
  const innerHeight = HEIGHT - PADDING.top - PADDING.bottom
  const x = (index: number) =>
    PADDING.left + (data.length <= 1 ? innerWidth / 2 : (innerWidth * index) / (data.length - 1))
  const y = (value: number) => PADDING.top + innerHeight * (1 - value / max)
  const points = (values: readonly number[]) => values.map((value, index) => `${x(index)},${y(value)}`).join(' ')
  const stacked = {
    done: data.map((point) => point.done),
    review: data.map((point) => point.done + point.inReview),
    progress: data.map((point) => point.done + point.inReview + point.inProgress),
    total: totals,
  }
  return chartFrame(
    <>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className='w-full min-w-[320px] h-[220px]'
        role='img'
        aria-label='Cumulative flow by status'
      >
        <Axis labels={labels} max={max} />
        <polyline
          points={points(stacked.total)}
          fill='none'
          stroke='var(--chart-seq-1, #94c2c8)'
          strokeWidth='24'
          strokeLinejoin='round'
        />
        <polyline
          points={points(stacked.progress)}
          fill='none'
          stroke='var(--chart-seq-2, #54a1aa)'
          strokeWidth='18'
          strokeLinejoin='round'
        />
        <polyline
          points={points(stacked.review)}
          fill='none'
          stroke='var(--chart-seq-3, #007a87)'
          strokeWidth='12'
          strokeLinejoin='round'
        />
        <polyline
          points={points(stacked.done)}
          fill='none'
          stroke='var(--chart-seq-4, #005963)'
          strokeWidth='6'
          strokeLinejoin='round'
        />
        {data.map((point, index) => (
          <circle
            key={point.bucketStart}
            cx={x(index)}
            cy={y(totals[index])}
            r='12'
            fill='transparent'
            onPointerEnter={() => setHover(index)}
            onPointerLeave={() => setHover(null)}
          >
            {hover === index && (
              <title>{`${shortDate(point.bucketStart)}: ${point.backlogTodo} backlog/todo, ${point.inProgress} in progress, ${point.inReview} in review, ${point.done} done`}</title>
            )}
          </circle>
        ))}
      </svg>
      <ul
        className='flex flex-wrap gap-3 text-xs text-text-muted list-none m-0 p-0'
        aria-label='Cumulative flow legend'
      >
        <li>■ Backlog/todo</li>
        <li>■ In progress</li>
        <li>■ In review</li>
        <li>■ Done</li>
      </ul>
    </>,
    'Cumulative flow',
    data.length === 0 || totals.every((total) => total === 0),
    'No issues in this window yet',
  )
}

/** Full-size responsive charts with axes, themed status bands, legends and native hover tooltips. */
export function ProjectFlowCharts({ flow }: { flow: FlowMetrics | null }) {
  const stable = useMemo(() => flow, [flow])
  if (!stable) return null
  return (
    <section className='mb-8' aria-labelledby='flow-charts-heading'>
      <h2
        id='flow-charts-heading'
        className='text-xs font-semibold text-text-muted m-0 mb-3 uppercase tracking-[0.05em]'
      >
        Flow (last 6 weeks)
      </h2>
      <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
        <ThroughputChart data={stable.throughputOverTime} />
        <CfdChart data={stable.cfdOverTime} />
      </div>
    </section>
  )
}
