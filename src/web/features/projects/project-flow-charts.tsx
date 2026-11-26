'use client'

import type { JSX } from 'react'

import { CfdChart, ThroughputChart } from '@/features/planning/flow-charts.tsx'

import type { FlowMetrics } from './schemas.ts'

/**
 * Overview and Metrics share the same chart geometry and raw-count semantics.
 *
 * @param {{ flow: FlowMetrics | null }} props The Flow Metrics data, when it is available.
 * @returns {false | JSX.Element} The throughput and cumulative flow charts, or false without metrics.
 */
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const ProjectFlowCharts = function ProjectFlowCharts({
  flow,
}: {
  flow: FlowMetrics | null
}): false | JSX.Element {
  if (!flow) {
    return false
  }
  return (
    <section className='mb-8' aria-labelledby='flow-charts-heading'>
      <h2
        id='flow-charts-heading'
        className='text-xs font-semibold text-text-muted m-0 mb-3 uppercase tracking-[0.05em]'
      >
        Flow (last 6 weeks)
      </h2>
      <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
        <div className='p-4 bg-surface border border-border rounded-lg overflow-x-auto'>
          <p className='m-0 mb-2 text-[0.72rem] font-medium text-text-muted'>Throughput</p>
          <ThroughputChart data={flow.throughputOverTime} />
        </div>
        <div className='p-4 bg-surface border border-border rounded-lg overflow-x-auto'>
          <p className='m-0 mb-2 text-[0.72rem] font-medium text-text-muted'>Cumulative flow</p>
          <CfdChart data={flow.cfdOverTime} />
        </div>
      </div>
    </section>
  )
}
