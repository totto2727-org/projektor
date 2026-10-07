import type { HTMLAttributes, ReactNode } from 'react'

import {
  Table as PrimitiveTable,
  TableHeader as PrimitiveTableHeader,
  TableBody as PrimitiveTableBody,
  TableRow as PrimitiveTableRow,
  TableHead as PrimitiveTableHead,
  TableCell as PrimitiveTableCell,
} from '../generated/table'

export interface TableProps {
  class?: string
  className?: string
  children: ReactNode
}
export function Table({ class: legacyClass, className, children }: TableProps) {
  return <PrimitiveTable className={[legacyClass, className].filter(Boolean).join(' ')}>{children}</PrimitiveTable>
}
export function TableHead({ children }: { children: ReactNode }) {
  return <PrimitiveTableHeader>{children}</PrimitiveTableHeader>
}
export function TableBody({ children }: { children: ReactNode }) {
  return <PrimitiveTableBody>{children}</PrimitiveTableBody>
}
export function TableRow({
  class: legacyClass,
  className,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & { class?: string; children: ReactNode }) {
  return <PrimitiveTableRow {...props} className={[legacyClass, className].filter(Boolean).join(' ')} />
}
export function TableHeaderCell({
  class: legacyClass,
  className,
  ...props
}: HTMLAttributes<HTMLTableCellElement> & { class?: string; children?: ReactNode }) {
  return <PrimitiveTableHead {...props} className={[legacyClass, className].filter(Boolean).join(' ')} />
}
export function TableCell({
  class: legacyClass,
  className,
  muted,
  ...props
}: HTMLAttributes<HTMLTableCellElement> & {
  class?: string
  muted?: boolean
  children: ReactNode
}) {
  return (
    <PrimitiveTableCell
      {...props}
      className={[muted && 'font-mono text-xs text-muted-foreground', legacyClass, className].filter(Boolean).join(' ')}
    />
  )
}
export { TableHeaderCell as TableHeader }
