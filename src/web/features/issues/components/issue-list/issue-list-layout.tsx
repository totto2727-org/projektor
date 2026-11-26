'use client'
import type { JSX } from 'react'

import type { Issue } from '@/features/issues/components/board-utils.ts'

import { IssueBulkProvider } from './bulk-actions.tsx'
import { CreateIssueModal } from './create-issue-modal.tsx'
import { deriveStatusOptions } from './derive.ts'
import { HeaderRow } from './header-row.tsx'
import { MainContent } from './main-content.tsx'
import { SprintBannerSection } from './sprint-banner-section.tsx'
import { Toolbar } from './toolbar.tsx'
import type { ViewMode } from './types-view.ts'
import type { useCreateIssueModal } from './use-create-issue-modal.ts'
import type { useIssueFilters } from './use-issue-filters.ts'
import type { useIssueListData } from './use-issue-list-data.ts'
import type { useIssueSearch } from './use-issue-search.ts'
import type { useSavedViews } from './use-saved-views.ts'

interface IssueListLayoutProps {
  workspaceSlug?: string
  view: ViewMode
  setView: (view: ViewMode) => void
  filtered: Issue[]
  projectDescription: string | null
  filters: ReturnType<typeof useIssueFilters>
  search: ReturnType<typeof useIssueSearch>
  data: ReturnType<typeof useIssueListData>
  saved: ReturnType<typeof useSavedViews>
  createModal: ReturnType<typeof useCreateIssueModal>
}

/**
 * Banners + toolbar + count/view-toggle row — everything above the main content area.
 *
 * @param {IssueListLayoutProps} props The issue-list state for filters, search, saved views, and creation.
 * @returns {JSX.Element} The controls for the current issue view and its result summary.
 */
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const IssueListTop = function IssueListTop({
  workspaceSlug,
  view,
  setView,
  filtered,
  projectDescription,
  filters,
  search,
  data,
  saved,
  createModal,
}: IssueListLayoutProps): JSX.Element {
  return (
    <>
      {/* Project description banner — shown when filtering by a specific project */}
      {filters.filterProject && projectDescription && (
        <p
          className={[
            'mb-4 px-[0.875rem] py-[0.625rem] bg-surface border border-border rounded-md text-sm',
            'text-text-muted leading-[1.5]',
          ].join(' ')}
        >
          {projectDescription}
        </p>
      )}

      {/* Sprint banner — shown when filtering by a specific sprint */}
      <SprintBannerSection
        filterSprintId={filters.filterSprintId}
        sprintDetail={data.sprintDetail}
        setFilterSprintId={filters.setFilterSprintId}
        workspaceSlug={workspaceSlug}
        issues={data.issues}
      />

      {data.updateError && (
        <p role='alert' className='text-danger-text mb-2'>
          {data.updateError}
        </p>
      )}

      <Toolbar
        searchQuery={search.searchQuery}
        setSearchQuery={search.setSearchQuery}
        isSearchActive={search.isSearchActive}
        searchInputRef={search.searchInputRef}
        searchRoute={search.route}
        derivedStatuses={deriveStatusOptions(data.issues, data.statuses)}
        filterStatuses={filters.filterStatuses}
        setFilterStatuses={filters.setFilterStatuses}
        filterPriorities={filters.filterPriorities}
        setFilterPriorities={filters.setFilterPriorities}
        filterDateField={filters.filterDateField}
        setFilterDateField={filters.setFilterDateField}
        filterDateFrom={filters.filterDateFrom}
        setFilterDateFrom={filters.setFilterDateFrom}
        filterDateTo={filters.filterDateTo}
        setFilterDateTo={filters.setFilterDateTo}
        uniqueProjects={data.projects.map(({ key, name }) => ({ key, name }))}
        filterProject={filters.filterProject}
        setFilterProject={filters.setFilterProject}
        setFilterSprintId={filters.setFilterSprintId}
        sprints={data.sprints}
        filterSprintId={filters.filterSprintId}
        uniqueTypes={data.taskTypes.map(({ key, name }): [string, string] => [key, name])}
        filterType={filters.filterType}
        setFilterType={filters.setFilterType}
        epics={data.epics}
        filterEpicId={filters.filterEpicId}
        setFilterEpicId={filters.setFilterEpicId}
        hideEpics={filters.hideEpics}
        setHideEpics={filters.setHideEpics}
        saved={saved}
        sortBy={filters.sortBy}
        setSortBy={filters.setSortBy}
        sortDir={filters.sortDir}
        setSortDir={filters.setSortDir}
      />

      <HeaderRow
        isSearchActive={search.isSearchActive}
        searchResults={search.searchResults}
        searchQuery={search.resultQuery}
        view={view}
        setView={setView}
        filtered={filtered}
        totalIssues={data.total}
        projectsCount={data.projects.length}
        openCreateModal={createModal.openCreateModal}
      />
    </>
  )
}

/**
 * Main content area (search/board/backlog/list) + the create-issue modal.
 *
 * @param {IssueListLayoutProps} props The filtered issues and their list, search, and creation state.
 * @returns {JSX.Element} The selected issue content and any open creation form.
 */
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const IssueListMain = function IssueListMain({
  view,
  filtered,
  search,
  data,
  filters,
  createModal,
}: IssueListLayoutProps): JSX.Element {
  return (
    <>
      <MainContent
        isSearchActive={search.isSearchActive}
        searchResults={search.searchResults}
        searchQuery={search.resultQuery}
        view={view}
        issues={filtered}
        statuses={data.statuses}
        updatingId={data.updatingId}
        updatingPriorityId={data.updatingPriorityId}
        changeStatus={data.changeStatus}
        changePriority={data.changePriority}
        sortBy={filters.sortBy}
        sortDir={filters.sortDir}
        onSort={filters.handleHeaderClick}
        pagination={data.pagination}
      />

      {/* Create issue modal (PROJ-62) */}
      {createModal.showCreateModal && (
        <CreateIssueModal
          createTitle={createModal.createTitle}
          setCreateTitle={createModal.setCreateTitle}
          createBody={createModal.createBody}
          setCreateBody={createModal.setCreateBody}
          createPriority={createModal.createPriority}
          setCreatePriority={createModal.setCreatePriority}
          createProjectId={createModal.createProjectId}
          setCreateProjectId={createModal.setCreateProjectId}
          createTypeId={createModal.createTypeId}
          setCreateTypeId={createModal.setCreateTypeId}
          createStatusId={createModal.createStatusId}
          setCreateStatusId={createModal.setCreateStatusId}
          createError={createModal.createError}
          submittingCreate={createModal.submittingCreate}
          createValid={createModal.createValid}
          workspaceSlug={createModal.workspaceSlug}
          submitCreate={createModal.submitCreate}
          setShowCreateModal={createModal.setShowCreateModal}
          projects={data.projects}
          taskTypes={data.taskTypes}
          statuses={data.statuses}
        />
      )}
    </>
  )
}

/**
 * Assembles the toolbar, header, main content, and modals from the parent list's hook state.
 *
 * @param {IssueListLayoutProps} props The parent list's state and action callbacks.
 * @returns {JSX.Element} The issue view with bulk actions scoped to its filtered issues.
 */
// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function IssueListLayout(props: IssueListLayoutProps): JSX.Element {
  return (
    <div>
      <IssueListTop {...props} />
      <IssueBulkProvider
        issues={props.filtered}
        statuses={props.data.statuses}
        workspaceSlug={props.workspaceSlug ?? ''}
      >
        <IssueListMain {...props} />
      </IssueBulkProvider>
    </div>
  )
}
