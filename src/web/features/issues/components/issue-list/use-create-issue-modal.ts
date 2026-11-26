'use client'
import { Schema } from 'effect'
import { useActionState, useEffect, useState } from 'react'

import { createIssue } from '@/features/issues/actions.ts'
import { BodyText, Priority, RequiredText, Text, TitleText, useIssueForm } from '@/features/issues/forms.ts'
import { useUnsavedUnloadGuard } from '@/features/issues/utils/use-unsaved-unload-guard.ts'

import type { ProjectMeta } from './types.ts'

interface Params {
  workspaceSlug?: string
  filterProject: string
  projects: ProjectMeta[]
}

/**
 * Owns the "New issue" modal's form state and submit flow, isolated from the parent list.
 *
 * @param {Params} params The active workspace, project filter, and projects to offer when creating an issue.
 * @returns {ReturnType<typeof useCreateIssueModal>} The modal state, field controls, and issue creation submission state.
 */
export const useCreateIssueModal = function useCreateIssueModal({ workspaceSlug, filterProject, projects }: Params) {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const createForm = useIssueForm(
    {
      createTitle: '',
      createBody: '',
      createPriority: 'medium',
      createStatusId: '',
      createProjectId: '',
      createTypeId: '',
    },
    Schema.Struct({
      createTitle: TitleText,
      createBody: BodyText,
      createPriority: Priority,
      createStatusId: Text,
      createProjectId: RequiredText,
      createTypeId: Text,
    }),
  )
  const [createTitle, setCreateTitle] = createForm.field('createTitle')
  const [createBody, setCreateBody] = createForm.field('createBody')
  const [createPriority, setCreatePriority] = createForm.field('createPriority')
  const [createStatusId, setCreateStatusId] = createForm.field('createStatusId')
  const [createProjectId, setCreateProjectId] = createForm.field('createProjectId')
  const [createTypeId, setCreateTypeId] = createForm.field('createTypeId')
  const [result, submitCreate, submittingCreate] = useActionState(createIssue, null)
  const [openedResult, setOpenedResult] = useState(result)
  const createError =
    result && result !== openedResult && !result.ok ? `Failed to create issue: ${result.message}` : null
  useEffect(() => {
    if (result?.ok === true) {
      setShowCreateModal(false)
    }
  }, [result])
  useUnsavedUnloadGuard(showCreateModal && Boolean(createTitle.trim() || createBody.trim()))

  // Escape closes the create modal
  useEffect(() => {
    if (!showCreateModal) {
      return
    }
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setShowCreateModal(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
    }
  }, [showCreateModal])

  const openCreateModal = function openCreateModal(): void {
    const targetProjectId = filterProject
      ? (projects.find((project) => project.key === filterProject)?.id ?? projects[0]?.id ?? '')
      : (projects[0]?.id ?? '')
    setCreateProjectId(targetProjectId)
    setCreateTitle('')
    setCreateBody('')
    setCreatePriority('medium')
    setCreateStatusId('')
    setCreateTypeId('')
    setOpenedResult(result)
    setShowCreateModal(true)
  }

  return {
    workspaceSlug,
    createValid: createForm.isValid,
    showCreateModal,
    setShowCreateModal,
    createTitle,
    setCreateTitle,
    createBody,
    setCreateBody,
    createPriority,
    setCreatePriority,
    createStatusId,
    setCreateStatusId,
    createProjectId,
    setCreateProjectId,
    createTypeId,
    setCreateTypeId,
    submittingCreate,
    createError,
    openCreateModal,
    submitCreate,
  }
}
