'use client'

import { useEffect, useRef } from 'react'
import uPlot from 'uplot'

import 'uplot/dist/uPlot.min.css'

interface Props {
  data: uPlot.AlignedData
  buildOptions: (width: number, height: number) => uPlot.Options
  height?: number
}
/** The original vanilla canvas lifecycle, now hosted by a React client component. */
export default function UplotChart({ data, buildOptions, height = 220 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<uPlot | null>(null)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    function create(el: HTMLDivElement) {
      chartRef.current?.destroy()
      chartRef.current = new uPlot(buildOptions(el.clientWidth || 600, height), data, el)
    }
    create(container)
    const themeObserver = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.attributeName === 'data-theme')) create(container)
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
    const onSystemThemeChange = () => {
      if (!document.documentElement.getAttribute('data-theme')) create(container)
    }
    systemTheme.addEventListener('change', onSystemThemeChange)
    let lastWidth = container.clientWidth
    const resizeObserver = new ResizeObserver((entries) => {
      const newWidth = entries[0]?.contentRect.width
      if (newWidth && Math.abs(newWidth - lastWidth) > 1) {
        lastWidth = newWidth
        create(container)
      }
    })
    resizeObserver.observe(container)
    return () => {
      themeObserver.disconnect()
      systemTheme.removeEventListener('change', onSystemThemeChange)
      resizeObserver.disconnect()
      chartRef.current?.destroy()
      chartRef.current = null
    }
  }, [data, buildOptions, height])
  return <div ref={containerRef} className='w-full' />
}
export function createTooltipPlugin({
  formatX,
  formatY,
}: {
  formatX: (value: number) => string
  formatY: (value: number) => string
}): uPlot.Plugin {
  let tooltip: HTMLDivElement
  return {
    hooks: {
      init: (chart) => {
        tooltip = document.createElement('div')
        Object.assign(tooltip.style, {
          position: 'absolute',
          pointerEvents: 'none',
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '0.75rem',
          fontWeight: '500',
          whiteSpace: 'nowrap',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          boxShadow: 'var(--elevation-sm)',
          zIndex: '10',
          display: 'none',
        })
        chart.over.appendChild(tooltip)
      },
      setCursor: (chart) => {
        const index = chart.cursor.idx
        const value = index == null ? null : chart.data[1][index]
        if (index == null || value == null) {
          tooltip.style.display = 'none'
          return
        }
        tooltip.textContent = `${formatX(chart.data[0][index])}: ${formatY(value)}`
        tooltip.style.left = `${(chart.cursor.left ?? 0) + 12}px`
        tooltip.style.top = `${Math.max(0, (chart.cursor.top ?? 0) - 8)}px`
        tooltip.style.display = 'block'
      },
    },
  }
}
