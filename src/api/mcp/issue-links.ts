import { String, Predicate } from 'effect'

import { createLink, deleteLink, listLinksForIssue } from '#api/services/issue-links.ts'
import { ValidationError, validationIssues } from '#contracts/errors.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'

import { CREATE, DESTRUCTIVE, READ } from './annotations.ts'
import { requiredObjectInputSchema, describedInputProperty } from './input-schema.ts'
import type { MCPTool } from './types.ts'

export const issueLinksTools: MCPTool[] = [
  {
    annotations: CREATE,
    description: 'Create a typed link between two issues (blocks, blocked_by, relates_to, duplicates)',
    async handler(input, ctx) {
      return createLink(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['sourceIssueId', 'targetIssueId', 'type'], {
      sourceIssueId: describedInputProperty('string', 'UUID of the source issue, or a ref like PROJ-42'),
      targetIssueId: describedInputProperty('string', 'UUID of the target issue, or a ref like PROJ-42'),
      type: fieldsInOrder([
        ['type', 'string'],
        ['enum', ['blocks', 'blocked_by', 'relates_to', 'duplicates']],
        ['description', "Relationship type from the source issue's perspective"],
      ]),
    }),
    name: 'create_issue_link',
  },
  {
    annotations: DESTRUCTIVE,
    description: 'Delete an issue link by ID',
    async handler(input, ctx) {
      const { id } = input as { id?: string }
      if (!Predicate.isString(id) || String.isEmpty(id)) {
        throw new ValidationError(validationIssues(['id is required'], {}))
      }
      return deleteLink(ctx, { id })
    },
    inputSchema: requiredObjectInputSchema(['id'], {
      id: describedInputProperty('string', 'UUID of the link to delete'),
    }),
    name: 'delete_issue_link',
  },
  {
    annotations: READ,
    description: "List all links for an issue (shows effective type from this issue's perspective)",
    async handler(input, ctx) {
      return listLinksForIssue(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['issueId'], {
      issueId: describedInputProperty('string', 'UUID of the issue, or a ref like PROJ-42'),
    }),
    name: 'list_issue_links',
  },
]
