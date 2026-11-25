import { Predicate } from 'effect'

import {
  endAgent,
  finishWork,
  heartbeatAgent,
  listActiveAgents,
  registerAgent,
  startWork,
} from '#api/services/agents.ts'
import { ValidationError, validationIssues } from '#contracts/errors.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'

import { PLAIN_WRITE, READ } from './annotations.ts'
import { objectInputSchema, requiredObjectInputSchema, describedInputProperty } from './input-schema.ts'
import type { MCPTool } from './types.ts'

/** Claim_issue names the session `agentId`; heartbeat/end call it `id`. Accept both. */
const withIdAlias = function withIdAlias(input: unknown): unknown {
  const { agentId, ...rest } = (input ?? {}) as { agentId?: unknown; id?: unknown }
  if (Predicate.isNullish(agentId)) {
    return rest
  }
  if (Predicate.isNullish(rest.id)) {
    return { ...rest, id: agentId }
  }
  if (rest.id !== agentId) {
    throw new ValidationError(validationIssues([], { agentId: ['conflicts with id — pass one of them'] }))
  }
  return rest
}

const COMPLETION_REPORT_PROPERTIES = fieldsInOrder([
  ['summary', { type: 'string' }],
  ['verification', { type: 'string' }],
  ['prLink', { type: 'string' }],
])

export const agentsTools: MCPTool[] = [
  {
    annotations: PLAIN_WRITE,
    description:
      'Register an agent session and claim an issue (plus files, if given) in one call — ' +
      'replaces register_agent + claim_issue + claim_files + post_message. All-or-nothing with ' +
      'compensating cleanup: on any conflict (same errors as claim_issue/claim_files) the session is ' +
      'ended and nothing is left claimed. If the process crashes mid-call, the same claims become ' +
      "reclaimable once the session's heartbeat goes stale (120s).",
    async handler(input, ctx) {
      return startWork(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(
      ['issue', 'name'],
      fieldsInOrder([
        ['issue', describedInputProperty('string', 'Issue UUID to claim')],
        [
          'paths',
          fieldsInOrder([
            ['type', 'array'],
            ['items', { type: 'string' }],
            ['description', 'File paths to claim alongside the issue (optional)'],
          ]),
        ],
        ['name', describedInputProperty('string', 'Display name for the agent session (max 200)')],
      ]),
    ),
    name: 'start_work',
  },
  {
    annotations: PLAIN_WRITE,
    description:
      'Optionally transition an issue (completion-report rules apply, same as update_issue), then ' +
      'release every claim/lease the session holds and end it — replaces update_issue + ' +
      'release_issue + release_files + end_agent.',
    async handler(input, ctx) {
      return finishWork(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(
      ['sessionId', 'issue'],
      fieldsInOrder([
        ['sessionId', describedInputProperty('string', 'Agent session UUID to end')],
        ['issue', describedInputProperty('string', 'Issue UUID to optionally transition')],
        ['status', describedInputProperty('string', 'New status for the issue (optional)')],
        [
          'completionReport',
          fieldsInOrder([
            ['type', 'object'],
            [
              'description',
              'Completion report, required by the review gate in the same cases update_issue requires it (optional)',
            ],
            ['properties', COMPLETION_REPORT_PROPERTIES],
          ]),
        ],
      ]),
    ),
    name: 'finish_work',
  },
  {
    annotations: PLAIN_WRITE,
    description: 'Register an agent session, optionally linked to an issue',
    async handler(input, ctx) {
      return registerAgent(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(
      ['name'],
      fieldsInOrder([
        ['name', describedInputProperty('string', 'Display name for the agent session (max 200)')],
        ['issueId', describedInputProperty('string', 'Issue UUID to link this session to (optional)')],
        [
          'kind',
          fieldsInOrder([
            ['type', 'string'],
            ['enum', ['agent', 'human']],
            [
              'description',
              'Deprecated, ignored (PROJ-336): self-declared session kind drives no behavior and is not returned.',
            ],
          ]),
        ],
      ]),
    ),
    name: 'register_agent',
  },
  {
    annotations: PLAIN_WRITE,
    description: 'Send a heartbeat to keep an agent session active',
    async handler(input, ctx) {
      return heartbeatAgent(ctx, withIdAlias(input))
    },
    inputSchema: objectInputSchema(
      fieldsInOrder([
        [
          'id',
          describedInputProperty(
            'string',
            'Agent session UUID. Optional when this credential has exactly one agent session; fleets sharing a credential must pass it',
          ),
        ],
        ['agentId', describedInputProperty('string', 'Alias for `id` (the name claim_issue uses)')],
      ]),
    ),
    name: 'heartbeat_agent',
  },
  {
    annotations: PLAIN_WRITE,
    description: 'End an agent session',
    async handler(input, ctx) {
      return endAgent(ctx, withIdAlias(input))
    },
    inputSchema: objectInputSchema(
      fieldsInOrder([
        [
          'id',
          describedInputProperty(
            'string',
            'Agent session UUID. Optional when this credential has exactly one agent session; fleets sharing a credential must pass it',
          ),
        ],
        ['agentId', describedInputProperty('string', 'Alias for `id` (the name claim_issue uses)')],
      ]),
    ),
    name: 'end_agent',
  },
  {
    annotations: READ,
    description:
      'List agent sessions in the workspace, optionally filtered by issue or project. An ended ' +
      'session is never returned. Live entries only by default — a session that has stopped ' +
      'heartbeating is also excluded; pass includeStale:true to include those too. Each entry ' +
      'carries a `live` flag (false when its heartbeat has gone stale) and, when tied to an issue, ' +
      'that issue\'s ref (e.g. "PROJ-857") as issueRef.',
    async handler(input, ctx) {
      return listActiveAgents(ctx, input)
    },
    inputSchema: objectInputSchema(
      fieldsInOrder([
        ['issueId', describedInputProperty('string', 'Filter by issue UUID (optional)')],
        [
          'projectId',
          describedInputProperty(
            'string',
            'Filter to sessions linked to an issue in this project — UUID or project key. ' +
              'A session with no issue link is excluded when this is given (optional)',
          ),
        ],
        [
          'includeStale',
          describedInputProperty(
            'boolean',
            'Include active sessions that have stopped heartbeating (default: false — live entries only). Never includes ended sessions.',
          ),
        ],
      ]),
    ),
    name: 'list_active_agents',
  },
]
