'use client'

import { useForm } from '@tanstack/react-form'
import { String, Array, Predicate, Schema } from 'effect'
import { useActionState, useEffect, useEffectEvent, useState } from 'react'

import { unwrapResult } from '@/client/functions.ts'
import { Badge } from '@/components/ui/badge.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import type { ActionResult } from '@/function-result.ts'

import { archiveSprint, createSprint, editSprint, moveSprintIssues, setSprintStatus } from './actions.ts'
import { FormErrors } from './form-ui.tsx'
import { formatUnixDate, getStoryPoints, issueHref, unixToDateInput } from './helpers.ts'
import { calendarOffset, MoveSprintIssuesSchema, SprintFormSchema } from './input-schemas.ts'
import type { SprintListMode } from './input-schemas.ts'
import type { ProjectIdentity, Sprint, SprintIssue } from './types.ts'

const CARD = 'px-5 py-4 bg-surface border border-border rounded-lg mb-3 last:mb-0'
const LABEL = 'block text-[0.78rem] font-semibold text-text-muted mb-[0.3rem] uppercase tracking-[0.04em]'
interface Draft {
  name: string
  goal: string
  start: string
  end: string
}
const emptyDraft = (): Draft => ({ name: '', goal: '', start: '', end: '' })
const fromSprint = (sprint: Sprint): Draft => ({
  name: sprint.name,
  goal: sprint.goal ?? '',
  start: unixToDateInput(sprint.startDate),
  end: unixToDateInput(sprint.endDate),
})

function StatusBadge({ status }: { status: Sprint['status'] }) {
  const style = {
    planned: { background: 'var(--surface)', color: 'var(--text-muted)' },
    active: { background: 'var(--sprint-active-bg)', color: 'var(--status-in-progress)' },
    completed: { background: 'var(--sprint-completed-bg)', color: 'var(--status-done)' },
  }[status]
  return (
    <Badge className='border border-current font-semibold capitalize' style={style}>
      {status}
    </Badge>
  )
}

/** Data stays prop-owned. A same-URL server refresh changes the list, not an open draft. */
export function SprintManager({
  projectId,
  workspaceSlug,
  initialSprints: sprints,
  initialIssues: issues = [],
  allSprints = sprints,
  mode = 'all',
  project,
}: {
  projectId: string
  workspaceSlug: string
  initialSprints: Sprint[]
  initialIssues?: SprintIssue[]
  /** Full canonical context for activation, moves and velocity, not list selection. */
  allSprints?: Sprint[]
  mode?: SprintListMode
  project?: ProjectIdentity
}) {
  const [showCreate, setShowCreate] = useState(false)
  const [completeId, setCompleteId] = useState<string | null>(null)
  const [completing, setCompleting] = useState(false)
  const [completeError, setCompleteError] = useState<string | null>(null)
  const [summary, setSummary] = useState<{ sprint: Sprint; issues: SprintIssue[] } | null>(null)
  const active = allSprints.filter((sprint) => sprint.status === 'active')
  const completed = allSprints.filter((sprint) => sprint.status === 'completed')
  async function complete(sprint: Sprint): Promise<void> {
    if (completing) {
      return
    }
    setCompleting(true)
    setCompleteError(null)
    // Snapshot the SSR issues before the mutation refresh, as in the original summary.
    const completedIssues = issues.filter((issue) => issue.sprint_id === sprint.id)
    try {
      unwrapResult(
        await setSprintStatus({
          workspaceSlug,
          projectId,
          sprintId: sprint.id,
          status: 'completed',
        }),
      )
      setCompleteId(null)
      setSummary({ sprint, issues: completedIssues })
    } catch (error) {
      setCompleteError(globalThis.String(error))
    }
    setCompleting(false)
  }
  const scopeQuery = new URLSearchParams({ projectId, workspace: workspaceSlug })
  return (
    <div>
      {project && (
        <nav className='text-sm text-text-muted mb-2'>
          <a href='/' className='text-text-muted no-underline'>
            Projects
          </a>
          <span className='mx-[0.375rem]'>/</span>
          <a href={`/projects/view?${scopeQuery}`} className='text-text-muted no-underline'>
            {project.name}
          </a>
          <span className='mx-[0.375rem]'>/</span>Sprints
        </nav>
      )}
      <div className='flex items-center gap-3 mb-5'>
        <h1 className='m-0 text-2xl font-bold text-text-base'>Sprints</h1>
        {project && (
          <span className='font-mono text-xs px-2 py-[0.125rem] rounded bg-surface border border-border text-text-muted'>
            {project.key}
          </span>
        )}
      </div>
      {summary && (
        <CompletionSummaryPanel
          summary={summary}
          workspaceSlug={workspaceSlug}
          onClose={() => {
            setSummary(null)
          }}
        />
      )}
      {Array.isArrayNonEmpty(active) && !showCreate && (
        <div
          role='status'
          className='mb-4 px-[0.875rem] py-[0.625rem] bg-sprint-notice-bg border border-sprint-notice-border rounded-md text-sm text-status-in-progress'
        >
          Sprint <strong>{active[0].name}</strong> is currently active.
        </div>
      )}
      <div className='flex justify-between items-center mb-4'>
        <p className='m-0 text-sm text-text-muted'>
          {allSprints.length} sprint{allSprints.length !== 1 ? 's' : ''}
        </p>
        {!showCreate && (
          <Button
            variant='primary'
            size='sm'
            onClick={() => {
              setShowCreate(true)
            }}
          >
            + New sprint
          </Button>
        )}
      </div>
      {showCreate && (
        <div className='mb-6 px-5 py-4 bg-surface border border-border rounded-lg'>
          <h3 className='m-0 mb-4 text-base font-semibold text-text-base'>New sprint</h3>
          {Array.isArrayNonEmpty(active) && (
            <div
              role='alert'
              className='mb-[0.875rem] px-3 py-2 bg-danger-bg border border-danger-border rounded text-[0.8rem] text-danger-text'
            >
              A sprint is already active. Only one sprint can be active at a time. The backend will reject activating a
              second one.
            </div>
          )}
          <SprintForm
            id='spr'
            initialValues={{ workspaceSlug, projectId, ...emptyDraft() }}
            onSuccess={() => {
              setShowCreate(false)
            }}
            onCancel={() => {
              setShowCreate(false)
            }}
            submitLabel='Create sprint'
          />
        </div>
      )}
      <nav className='flex flex-wrap gap-2 mb-4 border-0 p-0' aria-label='Sprint status views'>
        {(['all', 'planned', 'active', 'completed'] as const).map((value) => (
          <Button
            key={value}
            as='a'
            href={`/sprints?${new URLSearchParams({ projectId, workspace: workspaceSlug, status: value })}`}
            size='sm'
            variant={mode === value ? 'primary' : 'outline'}
            aria-current={mode === value ? 'page' : undefined}
          >
            {value === 'completed' ? 'History' : value[0].toUpperCase() + value.slice(1)}
          </Button>
        ))}
      </nav>
      {Array.isArrayEmpty(sprints) ? (
        <div className='p-8 text-center text-text-muted bg-surface rounded-lg border border-border'>
          <p className='m-0 mb-2'>{mode === 'all' ? 'No sprints yet.' : `No ${mode} sprints.`}</p>
          <p className='m-0 text-sm'>Create a sprint to organise issues into time-boxed iterations.</p>
        </div>
      ) : (
        sprints.map((sprint) => (
          <SprintRow
            key={sprint.id}
            sprint={sprint}
            sprints={allSprints}
            issues={issues}
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            completeId={completeId}
            completing={completing}
            completeError={completeError}
            onStartComplete={() => {
              setCompleteId(sprint.id)
              setCompleteError(null)
            }}
            onConfirmComplete={() => complete(sprint)}
            onCancelComplete={() => {
              setCompleteId(null)
            }}
          />
        ))
      )}
      {Array.isArrayNonEmpty(completed) && <VelocityChart sprints={completed.slice(-6)} issues={issues} />}
    </div>
  )
}

function SprintForm({
  id,
  initialValues,
  sprintId,
  onSuccess,
  onCancel,
  submitLabel,
}: {
  id: string
  initialValues: typeof SprintFormSchema.Type
  sprintId?: string
  onSuccess: () => void
  onCancel: () => void
  submitLabel: string
}) {
  const [defaults] = useState(() => initialValues)
  const [result, formAction, busy] = useActionState<ActionResult<{ id: string } | { ok: true }> | null, FormData>(
    Predicate.isNotNullish(sprintId) && String.isNonEmpty(sprintId) ? editSprint : createSprint,
    null,
  )
  const success = useEffectEvent(onSuccess)
  useEffect(() => {
    if (result?.ok === true) {
      success()
    }
  }, [result])
  const standard = Schema.toStandardSchemaV1(SprintFormSchema)
  const form = useForm({
    defaultValues: defaults,
    validators: { onMount: standard, onChange: standard, onSubmit: standard },
  })
  return (
    <form action={formAction}>
      <input type='hidden' name='workspaceSlug' value={defaults.workspaceSlug} />
      <input type='hidden' name='projectId' value={defaults.projectId} />
      {sprintId && <input type='hidden' name='sprintId' value={sprintId} />}
      <form.Subscribe selector={(state) => [state.values.start, state.values.end] as const}>
        {([start, end]) => (
          <>
            <input type='hidden' name='startOffset' value={calendarOffset(start)} />
            <input type='hidden' name='endOffset' value={calendarOffset(end)} />
          </>
        )}
      </form.Subscribe>
      <form.Subscribe
        selector={(state) => ({
          canSubmit: state.canSubmit,
          errors: state.errors,
          showErrors: state.isDirty || state.submissionAttempts > 0,
        })}
      >
        {({ canSubmit, errors, showErrors }) => (
          <>
            <div className='mb-4'>
              <label className={LABEL} htmlFor={`${id}-name`}>
                Name *
              </label>
              <form.Field name='name'>
                {(field) => (
                  <Input
                    id={`${id}-name`}
                    name='name'
                    type='text'
                    placeholder='e.g. Sprint 1'
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.currentTarget.value)}
                    required
                    maxLength={100}
                    disabled={busy}
                  />
                )}
              </form.Field>
            </div>
            <div className='mb-4'>
              <label className={LABEL} htmlFor={`${id}-goal`}>
                Goal (optional)
              </label>
              <form.Field name='goal'>
                {(field) => (
                  <Input
                    id={`${id}-goal`}
                    name='goal'
                    type='text'
                    placeholder='What do you want to achieve this sprint?'
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.currentTarget.value)}
                    maxLength={280}
                    disabled={busy}
                  />
                )}
              </form.Field>
            </div>
            <div className='flex flex-col sm:flex-row gap-4 mb-4'>
              <div className='flex-1'>
                <label className={LABEL} htmlFor={`${id}-start`}>
                  Start date (optional)
                </label>
                <form.Field name='start'>
                  {(field) => (
                    <Input
                      id={`${id}-start`}
                      name='start'
                      type='date'
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.currentTarget.value)}
                      disabled={busy}
                    />
                  )}
                </form.Field>
              </div>
              <div className='flex-1'>
                <label className={LABEL} htmlFor={`${id}-end`}>
                  End date (optional)
                </label>
                <form.Field name='end'>
                  {(field) => (
                    <Input
                      id={`${id}-end`}
                      name='end'
                      type='date'
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.currentTarget.value)}
                      disabled={busy}
                    />
                  )}
                </form.Field>
              </div>
            </div>
            {result?.ok === false && (
              <p role='alert' className='text-danger-text text-[0.8rem] m-0 mb-3'>
                {result.message}
              </p>
            )}
            {showErrors && <FormErrors errors={errors} />}
            <div className='flex gap-2 max-sm:flex-col'>
              <Button type='submit' variant='primary' size='sm' className='max-sm:w-full' disabled={busy || !canSubmit}>
                {busy ? 'Saving…' : submitLabel}
              </Button>
              <Button variant='outline' size='sm' className='max-sm:w-full' onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </form.Subscribe>
    </form>
  )
}

interface RowProps {
  sprint: Sprint
  sprints: Sprint[]
  issues: SprintIssue[]
  workspaceSlug: string
  projectId: string
  completeId: string | null
  completing: boolean
  completeError: string | null
  onStartComplete: () => void
  onConfirmComplete: () => void
  onCancelComplete: () => void
}
function SprintRow({
  sprint,
  sprints,
  issues,
  workspaceSlug,
  projectId,
  completeId,
  completing,
  completeError,
  onStartComplete,
  onConfirmComplete,
  onCancelComplete,
}: RowProps) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [archive, setArchive] = useState(false)
  const [moving, setMoving] = useState(false)
  const sprintIssues = issues.filter((issue) => issue.sprint_id === sprint.id)
  const done = sprintIssues.filter((issue) => issue.status_category === 'done')
  async function changeStatus(status: Sprint['status']): Promise<void> {
    if (busy) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      unwrapResult(await setSprintStatus({ workspaceSlug, projectId, sprintId: sprint.id, status }))
    } catch (currentError) {
      setError(globalThis.String(currentError))
    }
    setBusy(false)
  }
  async function archiveConfirmed(): Promise<void> {
    if (busy) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      unwrapResult(await archiveSprint({ workspaceSlug, projectId, sprintId: sprint.id }))
      setArchive(false)
    } catch (currentError) {
      setError(globalThis.String(currentError))
    }
    setBusy(false)
  }
  const query = new URLSearchParams({ projectId, workspace: workspaceSlug, sprintId: sprint.id })
  return (
    <div className={CARD}>
      <div className='flex items-center gap-3 flex-wrap mb-[0.375rem]'>
        <span className='font-semibold text-base text-text-base'>{sprint.name}</span>
        <StatusBadge status={sprint.status} />
      </div>
      {sprint.goal && <p className='text-sm text-text-muted italic mb-2'>{sprint.goal}</p>}
      <div className='text-[0.8rem] text-text-muted flex gap-4 flex-wrap mb-2'>
        <span>
          Start: <strong className='text-text-base'>{formatUnixDate(sprint.startDate)}</strong>
        </span>
        <span>
          End: <strong className='text-text-base'>{formatUnixDate(sprint.endDate)}</strong>
        </span>
        <span>
          Issues:{' '}
          <strong className='text-text-base'>
            {done.length}/{sprintIssues.length}
          </strong>
        </span>
        <span>
          Story points:{' '}
          <strong className='text-text-base'>
            {done.reduce((sum, issue) => sum + getStoryPoints(issue), 0)}/
            {sprintIssues.reduce((sum, issue) => sum + getStoryPoints(issue), 0)}
          </strong>
        </span>
      </div>
      {editing ? (
        <SprintForm
          id={`edit-${sprint.id}`}
          initialValues={{ workspaceSlug, projectId, ...fromSprint(sprint) }}
          sprintId={sprint.id}
          onSuccess={() => {
            setEditing(false)
          }}
          onCancel={() => {
            setEditing(false)
          }}
          submitLabel='Save sprint'
        />
      ) : (
        <div className='flex gap-2 items-center flex-wrap'>
          <Button as='a' href={`/issues?${query}`} variant='outline' size='sm'>
            View issues →
          </Button>
          <Button
            variant='outline'
            size='sm'
            disabled={busy}
            onClick={() => {
              setEditing(true)
              setError(null)
            }}
          >
            Edit
          </Button>
          {sprint.status === 'planned' && (
            <Button
              variant='primary'
              size='sm'
              disabled={busy || sprints.some((other) => other.status === 'active')}
              onClick={() => changeStatus('active')}
            >
              Start sprint
            </Button>
          )}
          {sprint.status === 'active' &&
            (completeId === sprint.id ? (
              <span className='inline-flex gap-[0.375rem] items-center flex-wrap'>
                <span className='text-[0.8rem] text-text-muted'>Mark complete?</span>
                <Button variant='danger' size='sm' disabled={completing} onClick={onConfirmComplete}>
                  {completing ? '…' : 'Yes, complete'}
                </Button>
                <Button variant='outline' size='sm' disabled={completing} onClick={onCancelComplete}>
                  Cancel
                </Button>
                {completeError && (
                  <span role='alert' className='text-danger-text text-xs'>
                    {completeError}
                  </span>
                )}
              </span>
            ) : (
              <Button variant='outline' size='sm' disabled={busy} onClick={onStartComplete}>
                Complete sprint
              </Button>
            ))}
          {sprint.status === 'completed' && (
            <Button variant='outline' size='sm' disabled={busy} onClick={() => changeStatus('planned')}>
              Return to planned
            </Button>
          )}
          <Button
            variant='outline'
            size='sm'
            disabled={busy}
            onClick={() => {
              setMoving(!moving)
            }}
          >
            Move issues
          </Button>
          {archive ? (
            <span className='inline-flex gap-2 items-center'>
              <span className='text-[0.8rem] text-text-muted'>Archive sprint? Issues will be unassigned.</span>
              <Button variant='danger' size='sm' disabled={busy} onClick={archiveConfirmed}>
                Yes, archive
              </Button>
              <Button
                variant='outline'
                size='sm'
                disabled={busy}
                onClick={() => {
                  setArchive(false)
                }}
              >
                Cancel
              </Button>
            </span>
          ) : (
            <Button
              variant='outline'
              size='sm'
              disabled={busy}
              onClick={() => {
                setArchive(true)
              }}
            >
              Archive
            </Button>
          )}
        </div>
      )}
      {error && !editing && (
        <p role='alert' className='text-danger-text text-xs mt-2'>
          {error}
        </p>
      )}
      {moving && (
        <MoveIssuesForm
          sprint={sprint}
          sprints={sprints}
          issues={sprintIssues}
          projectId={projectId}
          workspaceSlug={workspaceSlug}
          onClose={() => {
            setMoving(false)
          }}
        />
      )}
    </div>
  )
}

function MoveIssuesForm({
  sprint,
  sprints,
  issues,
  workspaceSlug,
  projectId,
  onClose,
}: {
  sprint: Sprint
  sprints: Sprint[]
  issues: SprintIssue[]
  workspaceSlug: string
  projectId: string
  onClose: () => void
}) {
  const [defaults] = useState(() => ({
    workspaceSlug,
    projectId,
    sprintId: sprint.id,
    targetId: '',
    issueIds: issues.filter((issue) => issue.status_category !== 'done').map((issue) => issue.id),
  }))
  const standard = Schema.toStandardSchemaV1(MoveSprintIssuesSchema)
  const [error, setError] = useState<string | null>(null)
  const form = useForm({
    defaultValues: defaults,
    validators: { onMount: standard, onChange: standard, onSubmit: standard },
    onSubmit: async ({ value }) => {
      setError(null)
      try {
        unwrapResult(await moveSprintIssues(value))
        onClose()
      } catch (currentError) {
        setError(globalThis.String(currentError))
      }
    },
  })
  return (
    <form
      className='mt-4'
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.Subscribe
        selector={(state) => ({
          busy: state.isSubmitting,
          canSubmit: state.canSubmit,
          errors: state.errors,
          showErrors: state.isDirty || state.submissionAttempts > 0,
        })}
      >
        {({ busy, canSubmit, errors, showErrors }) => (
          <>
            <h3 className='text-sm font-semibold'>Move issues to another sprint</h3>
            <div className='flex flex-col gap-1 mb-3'>
              <form.Field name='issueIds'>
                {(field) => (
                  <>
                    {issues.map((issue) => (
                      <label key={issue.id} className='text-sm flex gap-2 items-center'>
                        <input
                          type='checkbox'
                          checked={field.state.value.includes(issue.id)}
                          onBlur={field.handleBlur}
                          onChange={(event) => {
                            field.handleChange(
                              event.currentTarget.checked
                                ? [...field.state.value, issue.id]
                                : field.state.value.filter((id) => id !== issue.id),
                            )
                          }}
                          disabled={busy}
                        />
                        <a className='text-accent' href={issueHref(issue, workspaceSlug)}>
                          {issue.project_key}-{issue.number}: {issue.title}
                        </a>
                      </label>
                    ))}
                  </>
                )}
              </form.Field>
              {Array.isArrayEmpty(issues) && <p className='text-text-muted text-sm'>No issues in this sprint.</p>}
            </div>
            <label className='text-sm' htmlFor={`move-target-${sprint.id}`}>
              Destination{' '}
              <form.Field name='targetId'>
                {(field) => (
                  <select
                    id={`move-target-${sprint.id}`}
                    className='px-3 py-2 border border-border rounded bg-bg text-text-base'
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.currentTarget.value)
                    }}
                    disabled={busy}
                  >
                    <option value=''>Select sprint…</option>
                    {sprints
                      .filter((item) => item.id !== sprint.id && item.status !== 'completed')
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                  </select>
                )}
              </form.Field>
            </label>
            {showErrors && <FormErrors errors={errors} />}
            {error && (
              <p role='alert' className='text-danger-text text-xs'>
                {error}
              </p>
            )}
            <form.Subscribe selector={(state) => state.values.issueIds.length}>
              {(count) => (
                <Button type='submit' variant='primary' size='sm' disabled={busy || !canSubmit}>
                  Move {count} issues
                </Button>
              )}
            </form.Subscribe>
            <Button size='sm' variant='outline' disabled={busy} onClick={onClose}>
              Cancel
            </Button>
          </>
        )}
      </form.Subscribe>
    </form>
  )
}

function CompletionSummaryPanel({
  summary,
  workspaceSlug,
  onClose,
}: {
  summary: { sprint: Sprint; issues: SprintIssue[] }
  workspaceSlug: string
  onClose: () => void
}) {
  const { sprint, issues } = summary
  const done = issues.filter((issue) => issue.status_category === 'done')
  const totalSP = issues.reduce((sum, issue) => sum + getStoryPoints(issue), 0)
  const doneSP = done.reduce((sum, issue) => sum + getStoryPoints(issue), 0)
  return (
    <div className='mb-6 px-5 py-4 bg-success-bg border border-success-border rounded-lg'>
      <div className='flex justify-between items-start mb-3'>
        <h3 className='m-0 text-base font-semibold text-text-base'>Sprint complete: {sprint.name}</h3>
        <button type='button' className='text-sm text-text-muted hover:text-text-base' onClick={onClose}>
          Close
        </button>
      </div>
      {(Predicate.isNotNullish(sprint.startDate) || Predicate.isNotNullish(sprint.endDate)) && (
        <p className='text-sm text-text-muted m-0 mb-3'>
          {formatUnixDate(sprint.startDate)} – {formatUnixDate(sprint.endDate)}
        </p>
      )}
      <div className='flex gap-6 mb-4 text-sm flex-wrap'>
        <div>
          <span className='text-text-muted'>Issues:</span>{' '}
          <strong className='text-text-base'>
            {done.length}/{issues.length}
          </strong>
        </div>
        {totalSP > 0 && (
          <div>
            <span className='text-text-muted'>Story points:</span>{' '}
            <strong className='text-text-base'>
              {doneSP}/{totalSP}
            </strong>
          </div>
        )}
      </div>
      {Array.isArrayNonEmpty(done) && (
        <div>
          <p className='m-0 mb-2 text-[0.78rem] font-semibold text-text-muted uppercase tracking-[0.04em]'>
            Completed issues
          </p>
          <ul className='m-0 p-0 list-none flex flex-col gap-1'>
            {done.map((issue) => (
              <li key={issue.id}>
                <a href={issueHref(issue, workspaceSlug)} className='text-sm text-accent no-underline hover:underline'>
                  {issue.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
function VelocityChart({ sprints, issues }: { sprints: Sprint[]; issues: SprintIssue[] }) {
  const data = sprints.map((sprint) => {
    const rows = issues.filter((issue) => issue.sprint_id === sprint.id)
    return {
      sprint,
      pointsCompleted: rows
        .filter((issue) => issue.status_category === 'done')
        .reduce((sum, issue) => sum + getStoryPoints(issue), 0),
      pointsTotal: rows.reduce((sum, issue) => sum + getStoryPoints(issue), 0),
    }
  })
  const max = Math.max(1, ...data.map((row) => row.pointsTotal))
  return (
    <div className='mt-8 p-5 bg-surface border border-border rounded-lg'>
      <h2 className='m-0 mb-4 text-base font-semibold text-text-base'>Velocity</h2>
      <div>
        <div className='flex items-end gap-2 h-[148px]'>
          {data.map(({ sprint, pointsCompleted, pointsTotal }) => {
            const totalH = Math.round((pointsTotal / max) * 100)
            const doneH = totalH > 0 ? Math.round((pointsCompleted / pointsTotal) * totalH) : 0
            return (
              <div key={sprint.id} className='flex-1 flex flex-col items-center justify-end min-w-0 h-[148px]'>
                <div className='text-[0.7rem] font-semibold text-text-base mb-1'>
                  {pointsCompleted}
                  {pointsTotal > 0 && pointsCompleted !== pointsTotal && (
                    <span className='font-normal text-text-muted'>/{pointsTotal}</span>
                  )}
                </div>
                <div
                  className='relative w-full rounded-t bg-velocity-bar-bg'
                  style={{ height: `${Math.max(totalH, 2)}px` }}
                >
                  {doneH > 0 && (
                    <div
                      className='absolute bottom-0 left-0 right-0 rounded-t bg-status-done opacity-80'
                      style={{ height: `${doneH}px` }}
                    />
                  )}
                </div>
                <div className='mt-1 text-[0.65rem] text-text-muted truncate w-full text-center leading-tight px-1'>
                  {sprint.name}
                </div>
              </div>
            )
          })}
        </div>
        <div className='mt-3 flex gap-4 text-xs text-text-muted'>
          <span className='inline-flex items-center gap-1'>
            <span className='inline-block w-3 h-2 rounded-xs bg-status-done opacity-80' />
            Completed SP
          </span>
          <span className='inline-flex items-center gap-1'>
            <span className='inline-block w-3 h-2 rounded-xs bg-velocity-bar-bg' />
            Total SP
          </span>
        </div>
      </div>
    </div>
  )
}
