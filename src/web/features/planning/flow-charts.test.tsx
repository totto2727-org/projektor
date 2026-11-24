// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { Iterable } from 'effect'
import { isValidElement } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import type { ChartTooltipContent } from '@/components/generated/chart.tsx'

import {
  AgingWipScatter,
  ArrivalVsCompletionChart,
  BugShareChart,
  CfdChart,
  ReviewLatencyChart,
  ThroughputChart,
  WipChart,
} from './flow-charts.tsx'

// These mocks observe the public Recharts data/primitive boundary, not visual appearance.
// MetricsDashboard.test.tsx separately renders actual Recharts components.
const calls = vi.hoisted(() => new Map<string, Record<string, unknown>[]>())
vi.mock('recharts', () => {
  // oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires the chart test double to remain an expression.
  const primitive = (name: string) => (props: Record<string, unknown> & { children?: ReactNode }) => {
    const entries = calls.get(name) ?? []
    entries.push(props)
    calls.set(name, entries)
    return <>{props.children}</>
  }
  return Object.fromEntries(
    [
      'ResponsiveContainer',
      'Area',
      'AreaChart',
      'Bar',
      'BarChart',
      'CartesianGrid',
      'ComposedChart',
      'Legend',
      'Line',
      'LineChart',
      'ReferenceLine',
      'Scatter',
      'Tooltip',
      'XAxis',
      'YAxis',
    ].map((name) => [name, primitive(name)]),
  )
})
beforeEach(() => calls.clear())
afterEach(cleanup)
const first = (name: string): Record<string, unknown> => {
  const props = calls.get(name)?.[0]
  if (!props) {
    throw new Error(`Missing ${name}`)
  }
  return props
}
function tooltipProps() {
  const content = first('Tooltip').content
  if (!isValidElement<ComponentProps<typeof ChartTooltipContent>>(content)) {
    throw new Error('Missing tooltip content')
  }
  return content.props
}

describe('flow chart public data and primitive semantics', () => {
  test('formats throughput tooltip dates and count labels with the original contract', () => {
    render(<ThroughputChart data={[{ bucketStart: '2026-10-01', count: 4 }]} />)
    const props = tooltipProps()
    expect(props.labelFormatter?.('2026-10-01', [])).toBe('Oct 1, 2026')
    render(
      <>
        {props.formatter?.(4, 'count', { graphicalItemId: 'test', dataKey: 'count', name: 'count', value: 4 }, 0, [])}
      </>,
    )
    expect(screen.getByText('Issues completed')).toBeTruthy()
    expect(screen.getByText('4 completed')).toBeTruthy()
  })

  test('uses the WIP payload date when generated tooltip passes its numeric-axis config label', () => {
    render(<WipChart data={[{ date: '2026-10-01', count: 3 }]} />)
    const props = tooltipProps()
    expect(
      props.labelFormatter?.('WIP', [{ graphicalItemId: 'test', dataKey: 'count', payload: { date: '2026-10-01' } }]),
    ).toBe('Oct 1, 2026')
    render(
      <>
        {props.formatter?.(3, 'count', { graphicalItemId: 'test', dataKey: 'count', name: 'count', value: 3 }, 0, [])}
      </>,
    )
    expect(screen.getByText('3 in progress')).toBeTruthy()
  })

  test('stacks raw CFD counts once, bottom-up, with linear geometry and existing sequential tokens', () => {
    const data = Object.freeze([{ bucketStart: '2026-10-01', backlogTodo: 4, inProgress: 3, inReview: 2, done: 1 }])
    render(<CfdChart data={data} />)
    expect(first('AreaChart').data).toBe(data)
    const areas = calls.get('Area') ?? []
    expect(areas.map((area) => area.dataKey)).toStrictEqual(['done', 'inReview', 'inProgress', 'backlogTodo'])
    expect(areas.every((area) => area.stackId === 'states' && area.type === 'linear' && area.fillOpacity === 1)).toBe(
      true,
    )
    const chart = screen.getByTestId('flow-chart-cfd')
    expect(chart.textContent).toContain('--color-backlogTodo: var(--chart-seq-1)')
    expect(chart.textContent).toContain('--color-done: var(--chart-seq-4)')
    expect(chart.getAttribute('data-chart')).toMatch(/^chart-flow-cfd-[a-zA-Z0-9_-]+$/u)
  })

  test('accepts readonly throughput without cloning or modifying its counts', () => {
    const data = Object.freeze([{ bucketStart: '2026-10-01', count: 4 }])
    render(<ThroughputChart data={data} />)
    expect(first('BarChart').data).toBe(data)
    expect(first('Bar').dataKey).toBe('count')
    expect(first('YAxis').allowDecimals).toBe(false)
  })

  test('retains fraction bounds and null gaps, including zero as a real bug-share signal', () => {
    const data = [
      { bucketStart: '2026-10-01', total: 4, bugCount: 0, bugSharePercent: 0 },
      { bucketStart: '2026-10-02', total: 0, bugCount: 0, bugSharePercent: null },
    ]
    render(<BugShareChart data={data} bugTypeTracked />)
    expect(first('LineChart').data).toBe(data)
    expect(first('Line').connectNulls).toBe(false)
    expect(first('YAxis').domain).toEqual([0, 1])
    expect(first('Line').dataKey).toBe('bugSharePercent')
  })

  test('retains review p50 and null gaps rather than filling absent samples', () => {
    const data = [
      { bucketStart: '2026-10-01', p50: 1800 },
      { bucketStart: '2026-10-02', p50: null },
    ]
    render(<ReviewLatencyChart data={data} />)
    expect(first('LineChart').data).toBe(data)
    expect(first('Line').dataKey).toBe('p50')
    expect(first('Line').connectNulls).toBe(false)
  })

  test('preserves elapsed-time WIP spacing instead of treating irregular dates as equidistant', () => {
    render(
      <WipChart
        data={[
          { date: '2026-10-01', count: 3 },
          { date: '2026-10-04', count: 1 },
        ]}
      />,
    )
    expect(first('LineChart').data).toEqual([
      { date: '2026-10-01', count: 3, timestamp: Date.parse('2026-10-01') },
      { date: '2026-10-04', count: 1, timestamp: Date.parse('2026-10-04') },
    ])
    expect(first('XAxis').scale).toBe('time')
    expect(first('XAxis').type).toBe('number')
  })

  test('retains arrivals, completions and signed net with a dashed net line', () => {
    const data = [{ bucketStart: '2026-10-01', created: 2, completed: 4, net: -2 }]
    render(<ArrivalVsCompletionChart data={data} />)
    expect(first('LineChart').data).toBe(data)
    expect(calls.get('Line')?.map((line) => line.dataKey)).toEqual(['created', 'completed', 'net'])
    expect(calls.get('Line')?.[2].strokeDasharray).toBe('4 4')
  })

  test('preserves aging jitter, status groups, zero baseline, headroom and defined p50/p90 guides', () => {
    const data = [
      { id: 'i1', status: 'in_progress' as const, ageSeconds: 100 },
      { id: 'i2', status: 'in_review' as const, ageSeconds: 200 },
    ]
    render(<AgingWipScatter data={data} p50={0} p90={300} />)
    expect(first('XAxis').domain).toEqual([-0.5, 1.5])
    expect(first('XAxis').ticks).toEqual([0, 1])
    expect(first('YAxis').domain).toEqual([0, 330])
    expect(calls.get('ReferenceLine')?.map((line) => line.y)).toEqual([0, 300])
    expect(first('ComposedChart').data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ageSeconds: 100, id: 'i1', x: expect.any(Number) }),
        expect.objectContaining({ ageSeconds: 200, id: 'i2', x: expect.any(Number) }),
      ]),
    )
  })

  test('omits unavailable aging guides and keeps all-zero ages renderable', () => {
    render(<AgingWipScatter data={[{ id: 'i1', status: 'in_progress', ageSeconds: 0 }]} p50={null} p90={null} />)
    expect(calls.get('ReferenceLine')).toBeUndefined()
    expect(first('YAxis').domain).toEqual([0, 1])
    const props = tooltipProps()
    expect(
      props.formatter?.(0.125, 'x', { graphicalItemId: 'test', dataKey: 'x', name: 'x', value: 0.125 }, 0, []),
    ).toBeNull()
    render(
      <>
        {props.formatter?.(
          3600,
          'ageSeconds',
          { graphicalItemId: 'test', dataKey: 'ageSeconds', name: 'ageSeconds', value: 3600 },
          1,
          [],
        )}
      </>,
    )
    expect(screen.getByText('Age since claim')).toBeTruthy()
    expect(screen.getByText('1.0h')).toBeTruthy()
  })

  test('preserves empty and untracked messages instead of plotting synthetic values', () => {
    render(
      <>
        <ThroughputChart data={[]} />
        <CfdChart data={[]} />
        <BugShareChart data={[]} bugTypeTracked={false} />
        <ReviewLatencyChart data={[]} />
        <WipChart data={[]} />
        <ArrivalVsCompletionChart data={[]} />
        <AgingWipScatter data={[]} p50={null} p90={null} />
      </>,
    )
    Iterable.forEach(
      [
        'No completed issues yet',
        'No issues in this window yet',
        'Not tracked: no task type keyed "bug" exists in this workspace',
        'No review-latency data yet',
        'No WIP data yet',
        'No arrivals or completions yet',
        'No issues currently in progress or review',
      ],
      (message) => {
        expect(screen.getByText(message)).toBeTruthy()
      },
    )
    expect(calls.size).toBe(0)
  })
})
