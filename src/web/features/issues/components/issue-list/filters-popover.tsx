'use client'
import type { JSX, Dispatch, SetStateAction } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { categoryColor } from '@/features/issues/components/board-utils.ts'
import type { TaskStatus } from '@/features/issues/components/board-utils.ts'

const ACTIVE_PILL_FONT_WEIGHT = 600
const INACTIVE_PILL_FONT_WEIGHT = 400
const NO_ACTIVE_FILTERS = 0
const ACTIVE_DATE_FILTER_COUNT = 1

export type DateField = '' | 'completed' | 'updated'

/*
 * PROJ-588: opened low on a phone, this fixed-position panel had no viewport clamping —
 * the date-range fields and "Clear all" could fall below the viewport with nothing to
 * scroll to reach them. Same flip/clamp/scroll shape as Select.tsx's computeMenuPosition,
 * tuned for this panel's own width and content height rather than a listbox row.
 */
// 16rem, matches the inline minWidth below
const POPOVER_WIDTH = 256
const POPOVER_GAP = 4
const POPOVER_MARGIN = 8
const POPOVER_MIN_HEIGHT = 160
const POPOVER_MAX_HEIGHT = 420

export interface FiltersPopoverPos {
  top: number
  left: number
  maxHeight: number
}

export const computeFiltersPopoverPosition = function computeFiltersPopoverPosition(rect: DOMRect): FiltersPopoverPos {
  const left = Math.max(POPOVER_MARGIN, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - POPOVER_MARGIN))
  const below = window.innerHeight - rect.bottom - POPOVER_GAP - POPOVER_MARGIN
  const above = rect.top - POPOVER_GAP - POPOVER_MARGIN
  const flip = below < POPOVER_MIN_HEIGHT && above > below
  const space = flip ? above : below
  const maxHeight = Math.max(POPOVER_MIN_HEIGHT, Math.min(POPOVER_MAX_HEIGHT, space))
  const top = flip ? Math.max(POPOVER_MARGIN, rect.top - POPOVER_GAP - maxHeight) : rect.bottom + POPOVER_GAP
  return { top, left, maxHeight }
}

const PILL_COLORS: Record<string, { bg: string; text: string }> = {
  urgent: { bg: 'var(--priority-urgent-solid)', text: 'var(--on-accent)' },
  high: { bg: 'var(--priority-high-solid)', text: 'var(--on-accent)' },
  medium: { bg: 'var(--priority-medium-solid)', text: 'var(--on-accent)' },
  low: { bg: 'var(--priority-low-solid)', text: 'var(--on-accent)' },
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const StatusPills = function StatusPills({
  derivedStatuses,
  filterStatuses,
  setFilterStatuses,
}: {
  derivedStatuses: Readonly<TaskStatus[]>
  filterStatuses: string[]
  setFilterStatuses: Dispatch<SetStateAction<string[]>>
}): JSX.Element {
  return (
    <div className='flex flex-wrap gap-1 mb-3'>
      {derivedStatuses.map((selectedStatus) => {
        const active = filterStatuses.includes(selectedStatus.id)
        return (
          <button
            type='button'
            key={selectedStatus.id}
            aria-pressed={active}
            onClick={() => {
              setFilterStatuses((prev) =>
                active ? prev.filter((id) => id !== selectedStatus.id) : [...prev, selectedStatus.id],
              )
            }}
            className='py-1 px-[0.625rem] rounded-full cursor-pointer text-[0.8rem]'
            style={{
              border: active ? 'none' : '1px solid var(--border)',
              background: active ? categoryColor(selectedStatus.category) : 'var(--bg)',
              color: active ? 'var(--on-accent)' : 'var(--text)',
              fontWeight: active ? ACTIVE_PILL_FONT_WEIGHT : INACTIVE_PILL_FONT_WEIGHT,
            }}
          >
            {selectedStatus.name}
          </button>
        )
      })}
    </div>
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const PriorityPills = function PriorityPills({
  filterPriorities,
  setFilterPriorities,
}: {
  filterPriorities: string[]
  setFilterPriorities: Dispatch<SetStateAction<string[]>>
}): JSX.Element {
  return (
    <div className='flex flex-wrap gap-1'>
      {(['urgent', 'high', 'medium', 'low'] as const).map((priority) => {
        const active = filterPriorities.includes(priority)
        const col = PILL_COLORS[priority]
        return (
          <button
            type='button'
            key={priority}
            aria-pressed={active}
            onClick={() => {
              setFilterPriorities((prev) =>
                active ? prev.filter((selectedPriority) => selectedPriority !== priority) : [...prev, priority],
              )
            }}
            className='py-1 px-[0.625rem] rounded-full cursor-pointer text-[0.8rem] capitalize'
            style={{
              border: active ? 'none' : '1px solid var(--border)',
              background: active ? col.bg : 'var(--bg)',
              color: active ? col.text : 'var(--text)',
              fontWeight: active ? ACTIVE_PILL_FONT_WEIGHT : INACTIVE_PILL_FONT_WEIGHT,
            }}
          >
            {priority}
          </button>
        )
      })}
    </div>
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const DateRangeFilter = function DateRangeFilter({
  filterDateField,
  setFilterDateField,
  filterDateFrom,
  setFilterDateFrom,
  filterDateTo,
  setFilterDateTo,
}: {
  filterDateField: DateField
  setFilterDateField: Dispatch<SetStateAction<DateField>>
  filterDateFrom: string
  setFilterDateFrom: Dispatch<SetStateAction<string>>
  filterDateTo: string
  setFilterDateTo: Dispatch<SetStateAction<string>>
}): JSX.Element {
  return (
    <>
      {/* Date range (PROJ-212) — bound a chosen timestamp column server-side */}
      <div className='text-[0.7rem] font-semibold text-text-muted uppercase tracking-[0.04em] mb-2 mt-3'>
        Date range
      </div>
      <select
        aria-label='Date filter field'
        value={filterDateField}
        onChange={(event) => {
          setFilterDateField(event.target.value as DateField)
        }}
        className='w-full px-2 py-[0.3rem] border border-border rounded text-sm bg-bg text-text-base cursor-pointer'
      >
        <option value=''>No date filter</option>
        <option value='completed'>Completed date</option>
        <option value='updated'>Last edited date</option>
      </select>
      {filterDateField && (
        <div className='flex gap-2 mt-2'>
          <label className='flex-1 text-[0.7rem] text-text-muted'>
            From (UTC){' '}
            <input
              type='date'
              aria-label='From date'
              value={filterDateFrom}
              onInput={(event) => {
                setFilterDateFrom((event.target as HTMLInputElement).value)
              }}
              className='w-full px-2 py-[0.3rem] border border-border rounded text-sm bg-bg text-text-base mt-[0.2rem]'
            />
          </label>
          <label className='flex-1 text-[0.7rem] text-text-muted'>
            To (UTC){' '}
            <input
              type='date'
              aria-label='To date'
              value={filterDateTo}
              onInput={(event) => {
                setFilterDateTo((event.target as HTMLInputElement).value)
              }}
              className='w-full px-2 py-[0.3rem] border border-border rounded text-sm bg-bg text-text-base mt-[0.2rem]'
            />
          </label>
        </div>
      )}
    </>
  )
}

interface FiltersPopoverProps {
  derivedStatuses: Readonly<TaskStatus[]>
  filterStatuses: string[]
  setFilterStatuses: Dispatch<SetStateAction<string[]>>
  filterPriorities: string[]
  setFilterPriorities: Dispatch<SetStateAction<string[]>>
  filterDateField: DateField
  setFilterDateField: Dispatch<SetStateAction<DateField>>
  filterDateFrom: string
  setFilterDateFrom: Dispatch<SetStateAction<string>>
  filterDateTo: string
  setFilterDateTo: Dispatch<SetStateAction<string>>
  isSearchActive: boolean
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const FiltersToggleButton = function FiltersToggleButton({
  buttonRef,
  isSearchActive,
  activeFilterCount,
  onToggle,
}: {
  buttonRef: { current: HTMLButtonElement | null }
  isSearchActive: boolean
  activeFilterCount: number
  onToggle: () => void
}): JSX.Element {
  const activeStyle =
    activeFilterCount > NO_ACTIVE_FILTERS
      ? { border: 'none', background: 'var(--accent)', color: 'var(--on-accent)', fontWeight: 600 }
      : {
          border: '1px solid var(--border)',
          background: 'var(--bg)',
          color: 'var(--text)',
          fontWeight: 400,
        }
  const searchState = isSearchActive ? { cursor: 'default', opacity: 0.4 } : { cursor: 'pointer', opacity: 1 }

  return (
    <button
      ref={buttonRef}
      type='button'
      disabled={isSearchActive}
      onClick={onToggle}
      className='py-1 px-[0.625rem] rounded-full text-[0.8rem] transition-opacity duration-150'
      style={{
        ...activeStyle,
        ...searchState,
      }}
    >
      {activeFilterCount > NO_ACTIVE_FILTERS ? `Filters (${activeFilterCount})` : 'Filters'}
    </button>
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const FiltersPopoverContent = function FiltersPopoverContent(
  props: Pick<
    FiltersPopoverProps,
    | 'derivedStatuses'
    | 'filterStatuses'
    | 'setFilterStatuses'
    | 'filterPriorities'
    | 'setFilterPriorities'
    | 'filterDateField'
    | 'setFilterDateField'
    | 'filterDateFrom'
    | 'setFilterDateFrom'
    | 'filterDateTo'
    | 'setFilterDateTo'
  > & { activeFilterCount: number },
): JSX.Element {
  const {
    derivedStatuses,
    filterStatuses,
    setFilterStatuses,
    filterPriorities,
    setFilterPriorities,
    activeFilterCount,
  } = props
  return (
    <>
      <div className='text-[0.7rem] font-semibold text-text-muted uppercase tracking-[0.04em] mb-2'>Status</div>
      <StatusPills
        derivedStatuses={derivedStatuses}
        filterStatuses={filterStatuses}
        setFilterStatuses={setFilterStatuses}
      />
      <div className='text-[0.7rem] font-semibold text-text-muted uppercase tracking-[0.04em] mb-2'>Priority</div>
      <PriorityPills filterPriorities={filterPriorities} setFilterPriorities={setFilterPriorities} />
      <DateRangeFilter
        filterDateField={props.filterDateField}
        setFilterDateField={props.setFilterDateField}
        filterDateFrom={props.filterDateFrom}
        setFilterDateFrom={props.setFilterDateFrom}
        filterDateTo={props.filterDateTo}
        setFilterDateTo={props.setFilterDateTo}
      />
      {activeFilterCount > NO_ACTIVE_FILTERS && (
        <div className='border-t border-border pt-2 mt-3'>
          <button
            type='button'
            onClick={() => {
              setFilterStatuses([])
              setFilterPriorities([])
              props.setFilterDateField('')
              props.setFilterDateFrom('')
              props.setFilterDateTo('')
            }}
            className='bg-transparent border-none text-text-muted cursor-pointer text-[0.8rem] p-0'
          >
            ✕ Clear all
          </button>
        </div>
      )}
    </>
  )
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function FiltersPopover({
  derivedStatuses,
  filterStatuses,
  setFilterStatuses,
  filterPriorities,
  setFilterPriorities,
  filterDateField,
  setFilterDateField,
  filterDateFrom,
  setFilterDateFrom,
  filterDateTo,
  setFilterDateTo,
  isSearchActive,
}: FiltersPopoverProps): JSX.Element {
  const [showFiltersPopover, setShowFiltersPopover] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [popoverPos, setPopoverPos] = useState<FiltersPopoverPos | null>(null)

  const reposition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) {
      setPopoverPos(computeFiltersPopoverPosition(rect))
    }
  }, [])

  useEffect(() => {
    if (!showFiltersPopover) {
      return
    }
    const onPointer = function onPointer(event: MouseEvent): void {
      const target = event.target as Node
      if (containerRef.current?.contains(target) !== true && popoverRef.current?.contains(target) !== true) {
        setShowFiltersPopover(false)
      }
    }
    /*
     * Orientation change / desktop resize can invalidate a clamped position computed
     * at open time (e.g. rotating the phone the popover was flipped-above on).
     */
    window.addEventListener('resize', reposition)
    document.addEventListener('mousedown', onPointer)
    return () => {
      window.removeEventListener('resize', reposition)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [showFiltersPopover, reposition])

  const dateFilterActive = !!(filterDateField && (filterDateFrom || filterDateTo))
  const activeFilterCount =
    filterStatuses.length + filterPriorities.length + (dateFilterActive ? ACTIVE_DATE_FILTER_COUNT : NO_ACTIVE_FILTERS)

  return (
    <div className='relative' ref={containerRef}>
      <FiltersToggleButton
        buttonRef={buttonRef}
        isSearchActive={isSearchActive}
        activeFilterCount={activeFilterCount}
        onToggle={() => {
          if (showFiltersPopover) {
            setShowFiltersPopover(false)
          } else {
            reposition()
            setShowFiltersPopover(true)
          }
        }}
      />
      {showFiltersPopover && popoverPos && (
        <div
          ref={popoverRef}
          className='fixed z-[200] bg-surface border border-border rounded-lg p-3 shadow-elevation-sm min-w-64 max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain'
          style={{
            top: `${popoverPos.top}px`,
            left: `${popoverPos.left}px`,
            maxHeight: `${popoverPos.maxHeight}px`,
          }}
        >
          <FiltersPopoverContent
            derivedStatuses={derivedStatuses}
            filterStatuses={filterStatuses}
            setFilterStatuses={setFilterStatuses}
            filterPriorities={filterPriorities}
            setFilterPriorities={setFilterPriorities}
            filterDateField={filterDateField}
            setFilterDateField={setFilterDateField}
            filterDateFrom={filterDateFrom}
            setFilterDateFrom={setFilterDateFrom}
            filterDateTo={filterDateTo}
            setFilterDateTo={setFilterDateTo}
            activeFilterCount={activeFilterCount}
          />
        </div>
      )}
    </div>
  )
}
