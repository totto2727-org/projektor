import { queryFields } from '../../utils/query-fields'
import type { IssuesRoute } from '../../views/IssuesPage'

export interface IssuePagination {
  readonly route: IssuesRoute
  readonly nextCursor: string | number | null
}

/** Native GET controls keep pagination shareable and owned by Effront's public navigation. */
export function PageNavigation({ route, nextCursor }: IssuePagination) {
  const params = new URLSearchParams(route.search)
  const hasCursor = params.has('cursor')
  params.delete('cursor')
  if (nextCursor === null && !hasCursor) return null
  return (
    <nav aria-label='Issue pagination' className='flex justify-center gap-3 mt-4 py-2'>
      {hasCursor && (
        <a href={`${route.pathname}?${params}`} className='btn btn-secondary'>
          First page
        </a>
      )}
      {nextCursor !== null && (
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
