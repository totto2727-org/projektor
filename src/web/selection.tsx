import type { RequestScope } from './server'

/** Native GET forms also work without JavaScript and preserve explicit URL scope. */
export function ScopeSelection({ scope, url }: { scope: RequestScope; url: URL }) {
  const selection = scope.selection
  if (selection.kind !== 'selection-required') return null
  const project = selection.target === 'project'
  const options = project
    ? scope.projects
        .filter(
          (item) => !url.searchParams.get('workspace') || item.workspace_slug === url.searchParams.get('workspace'),
        )
        .map((item) => ({ value: item.id, label: `${item.workspace_name} / ${item.name}` }))
    : scope.workspaces.map((item) => ({ value: item.slug, label: item.name }))
  const name = project ? 'projectId' : 'workspace'
  const preservedParams = new Map(
    Array.from(url.searchParams)
      .filter(([key]) => key !== name && key !== 'project')
      .map(([key, value]) => [JSON.stringify([key, value]), { key, value }]),
  )
  return (
    <section className='card p-6' aria-labelledby='scope-heading'>
      <h1 id='scope-heading'>Select a {project ? 'project' : 'workspace'}</h1>
      {options.length === 0 ? (
        <p>
          No accessible {project ? 'projects' : 'workspaces'}. <a href='/'>View projects</a>
        </p>
      ) : (
        <form action={url.pathname} method='get'>
          {Array.from(preservedParams, ([identity, { key, value }]) => (
            <input key={identity} type='hidden' name={key} value={value} />
          ))}
          <label className='field-label' htmlFor='scope-choice'>
            {project ? 'Project' : 'Workspace'}
          </label>
          <select id='scope-choice' name={name} className='input' defaultValue={options[0].value}>
            {options.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <button type='submit' className='btn btn-primary mt-3'>
            Continue
          </button>
        </form>
      )}
    </section>
  )
}
