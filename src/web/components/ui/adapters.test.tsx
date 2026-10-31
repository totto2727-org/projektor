// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { Badge } from './Badge'
import { Button } from './Button'
import { Card } from './Card'
import { Dialog } from './Dialog'
import { EmptyState } from './EmptyState'
import { Field } from './Field'
import { Input, Textarea } from './Input'
import { Popover, Portal } from './Popover'
import Select from './Select'
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from './Table'

afterEach(cleanup)

describe('generated UI compatibility adapters', () => {
  it('keeps button, native form, anchor and noninteractive span modes', () => {
    render(
      <>
        <Button class='old' className='new'>
          Default
        </Button>
        <Button type='submit' name='action' value='save'>
          Save
        </Button>
        <Button as='a' href='/issues?projectId=p' target='_blank'>
          Issues
        </Button>
        <Button as='span' variant='danger' size='sm'>
          Label
        </Button>
      </>,
    )
    const button = screen.getByRole('button', { name: 'Default' })
    expect(button.getAttribute('type')).toBe('button')
    expect(button.classList.contains('old')).toBe(true)
    expect(button.classList.contains('new')).toBe(true)
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('type')).toBe('submit')
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('name')).toBe('action')
    const link = screen.getByRole('link', { name: 'Issues' })
    expect(link.getAttribute('href')).toBe('/issues?projectId=p')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(screen.getByText('Label').tagName).toBe('SPAN')
    expect(screen.getByText('Label').hasAttribute('role')).toBe(false)
  })

  it('preserves labels, native input names, refs and help/error precedence', () => {
    const inputRef = createRef<HTMLInputElement>()
    const textRef = createRef<HTMLTextAreaElement>()
    render(
      <>
        <Field label='Name' htmlFor='name' required help='Helpful' hint='Fallback'>
          <Input id='name' name='name' inputRef={inputRef} class='old' className='new' defaultValue='Initial' />
        </Field>
        <Field label='Notes' htmlFor='notes' error='Required' help='Hidden'>
          <Textarea id='notes' name='notes' inputRef={textRef} />
        </Field>
      </>,
    )
    expect(screen.getByRole('textbox', { name: 'Name' })).toBe(inputRef.current)
    expect(inputRef.current?.name).toBe('name')
    expect(inputRef.current?.value).toBe('Initial')
    expect(inputRef.current?.classList.contains('old')).toBe(true)
    expect(inputRef.current?.classList.contains('new')).toBe(true)
    expect(screen.getByRole('textbox', { name: 'Notes' })).toBe(textRef.current)
    expect(screen.getByText('Helpful')).toBeTruthy()
    expect(screen.queryByText('Fallback')).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe('Required')
    expect(screen.queryByText('Hidden')).toBeNull()
  })

  it('uses generated structural primitives and retains legacy table header alias', () => {
    render(
      <>
        <Badge style={{ color: 'red' }} class='old' className='new'>
          Priority
        </Badge>
        <Card as='a' href='/projects?id=p' interactive>
          Project
        </Card>
        <EmptyState
          title='No issues'
          description='Create one'
          icon={<span>Icon</span>}
          action={<Button>Create</Button>}
        />
        <Table class='old' className='new'>
          <TableHead>
            <TableRow>
              <TableHeader>Name</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow data-testid='row'>
              <TableCell muted>Issue</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </>,
    )
    expect(screen.getByText('Priority').getAttribute('data-slot')).toBe('badge')
    expect(screen.getByText('Priority').style.color).toBe('red')
    expect(screen.getByRole('link', { name: 'Project' }).querySelector('[data-slot="card"]')).toBeTruthy()
    expect(screen.getByText('No issues').getAttribute('data-slot')).toBe('empty-title')
    expect(screen.getByText('Create one')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy()
    expect(screen.getByRole('columnheader').tagName).toBe('TH')
    expect(screen.getByRole('cell').classList.contains('font-mono')).toBe(true)
    expect(screen.getByRole('table').classList.contains('old')).toBe(true)
    expect(screen.getByRole('table').classList.contains('new')).toBe(true)
  })

  it('delegates controlled dialog close requests to Base UI', async () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <Dialog open={false} onClose={onClose} title='Edit issue'>
        <Input aria-label='Issue title' />
      </Dialog>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(
      <Dialog open onClose={onClose} title='Edit issue' class='old' className='new'>
        <Input aria-label='Issue title' />
      </Dialog>,
    )
    const dialog = await screen.findByRole('dialog', { name: 'Edit issue' })
    expect(dialog.classList.contains('old')).toBe(true)
    expect(dialog.classList.contains('new')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    onClose.mockClear()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('maps old Select options to controlled string callbacks', async () => {
    const onChange = vi.fn()
    const options = [
      { value: '', label: 'None' },
      { value: 'todo', label: 'To do' },
      { value: 'done', label: 'Done' },
    ]
    const { rerender } = render(<Select options={options} value='todo' onChange={onChange} ariaLabel='Status' />)
    const trigger = screen.getByRole('combobox', { name: 'Status' })
    expect(trigger.textContent).toContain('To do')
    fireEvent.click(trigger)
    const option = await screen.findByRole('option', { name: 'Done' })
    fireEvent.pointerDown(option, { pointerType: 'mouse' })
    fireEvent.click(option)
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('done'))
    rerender(<Select options={options} value='done' onChange={onChange} ariaLabel='Status' disabled />)
    expect(screen.getByRole('combobox', { name: 'Status' }).textContent).toContain('Done')
    expect((screen.getByRole('combobox', { name: 'Status' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('supports legacy positioned popovers, refs and named framework Portal', async () => {
    const ref = createRef<HTMLDivElement>()
    const { container } = render(
      <Popover
        strategy='portal-fixed'
        position={{ top: 30, left: 20, width: 160 }}
        role='menu'
        ariaLabel='Actions'
        elementRef={ref}
        class='old'
        className='new'
      >
        <button type='button' role='menuitem'>
          Archive
        </button>
      </Popover>,
    )
    const menu = await screen.findByRole('menu', { name: 'Actions' })
    expect(menu).toBe(ref.current)
    expect(container.contains(menu)).toBe(false)
    expect(menu.classList.contains('old')).toBe(true)
    expect(menu.classList.contains('new')).toBe(true)
    expect(menu.parentElement?.style.top).toBe('30px')
    expect(menu.parentElement?.style.left).toBe('20px')
    cleanup()
    const host = document.createElement('div')
    document.body.appendChild(host)
    render(<Portal into={host} vnode={<span>Portaled content</span>} />)
    expect(host.textContent).toContain('Portaled content')
    cleanup()
    host.remove()
  })
})
