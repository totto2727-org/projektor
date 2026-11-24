import type { JSX, HTMLAttributes, ReactNode } from 'react'

import {
  Table as PrimitiveTable,
  TableHeader as PrimitiveTableHeader,
  TableBody as PrimitiveTableBody,
  TableRow as PrimitiveTableRow,
  TableHead as PrimitiveTableHead,
  TableCell as PrimitiveTableCell,
} from '@/components/generated/table.tsx'

export interface TableProps {
  class?: string
  className?: string
  children: ReactNode
}
export const Table = function Table({ class: legacyClass, className, children }: TableProps): JSX.Element {
  return <PrimitiveTable className={[legacyClass, className].filter(Boolean).join(' ')}>{children}</PrimitiveTable>
}
export const TableHead = function TableHead({ children }: { children: ReactNode }): JSX.Element {
  return <PrimitiveTableHeader>{children}</PrimitiveTableHeader>
}
export const TableBody = function TableBody({ children }: { children: ReactNode }): JSX.Element {
  return <PrimitiveTableBody>{children}</PrimitiveTableBody>
}
export const TableRow = function TableRow({
  class: legacyClass,
  className,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & { class?: string; children: ReactNode }): JSX.Element {
  return (
    <PrimitiveTableRow {...props} className={['border-border', legacyClass, className].filter(Boolean).join(' ')} />
  )
}
export function TableHeaderCell({
  class: legacyClass,
  className,
  ...props
}: HTMLAttributes<HTMLTableCellElement> & { class?: string; children?: ReactNode }): JSX.Element {
  return <PrimitiveTableHead {...props} className={[legacyClass, className].filter(Boolean).join(' ')} />
}
export const TableCell = function TableCell({
  class: legacyClass,
  className,
  muted,
  ...props
}: HTMLAttributes<HTMLTableCellElement> & {
  class?: string
  muted?: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <PrimitiveTableCell
      {...props}
      className={[muted && 'font-mono text-xs text-muted-foreground', legacyClass, className].filter(Boolean).join(' ')}
    />
  )
}
export { TableHeaderCell as TableHeader }
