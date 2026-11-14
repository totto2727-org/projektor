// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vite-plus/test'

vi.mock('../LazyMarkdownEditor', () => ({ default: () => <textarea aria-label='Description' /> }))

import CreateIssueModal from './CreateIssueModal'

function CreateHarness() {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [priority, setPriority] = useState('medium')
  const [project, setProject] = useState('project')
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  return (
    <>
      <button onClick={() => setOpen(true)}>New issue</button>
      {open && (
        <CreateIssueModal
          createTitle={title}
          setCreateTitle={setTitle}
          createBody={body}
          setCreateBody={setBody}
          createPriority={priority}
          setCreatePriority={setPriority}
          createProjectId={project}
          setCreateProjectId={setProject}
          createTypeId={type}
          setCreateTypeId={setType}
          createStatusId={status}
          setCreateStatusId={setStatus}
          createError={null}
          submittingCreate={false}
          createValid
          submitCreate={() => {}}
          setShowCreateModal={setOpen}
          projects={[]}
          taskTypes={[]}
          statuses={[]}
        />
      )}
    </>
  )
}

afterEach(cleanup)

it('keeps priority options interactive inside the dialog and dismisses with Escape', async () => {
  render(<CreateHarness />)
  const trigger = screen.getByRole('button', { name: 'New issue' })
  trigger.focus()
  fireEvent.click(trigger)
  const dialog = screen.getByRole('dialog', { name: 'Create new issue' })
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  const guards = document.querySelectorAll<HTMLElement>('[data-base-ui-focus-guard][data-type="inside"]')
  guards.item(guards.length - 1).focus()
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  fireEvent.click(screen.getByRole('combobox', { name: 'Select priority' }))
  const option = await screen.findByRole('option', { name: 'high' })
  fireEvent.pointerDown(option, { pointerType: 'mouse' })
  fireEvent.click(option)
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Select priority' }).textContent).toContain('high'))
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(trigger))
})
