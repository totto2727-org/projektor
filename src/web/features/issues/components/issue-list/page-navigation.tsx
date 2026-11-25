import { Predicate } from 'effect'
import type { JSX } from 'react'

import { queryFields } from '@/features/issues/utils/query-fields.ts'
import type { IssuesRoute } from '@/features/issues/views/issues-page.tsx'

export type IssuePagination = Readonly<{
  route: IssuesRoute
  nextCursor: string | number | null
}>

/** Native GET controls keep pagination shareable and owned by Effront's public navigation. */
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const PageNavigation = function PageNavigation({ route, nextCursor }: IssuePagination): false | JSX.Element {
  const params = new URLSearchParams(route.search)
  const hasCursor = params.has('cursor')
  params.delete('cursor')
  if (Predicate.isNullish(nextCursor) && !hasCursor) {
    return false
  }
  return (
    <nav aria-label='Issue pagination' className='flex justify-center gap-3 mt-4 py-2'>
      {hasCursor && (
        <a href={`${route.pathname}?${params}`} className='btn btn-secondary'>
          First page
        </a>
      )}
      {Predicate.isNotNullish(nextCursor) && (
        <form action={route.pathname} method='get'>
          {queryFields(params.toString()).map(({ name, value, key }) => (
            <input key={key} type='hidden' name={name} value={value} />
          ))}
          <input type='hidden' name='cursor' value={String(nextCursor)} />
          <button type='submit' className='btn btn-secondary'>
            Next page
          </button>
        </form>
      )}
    </nav>
  )
}
