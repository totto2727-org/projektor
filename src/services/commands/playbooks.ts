import { fieldsInOrder } from '#contracts/ordered-fields.ts'

import { NotFoundError } from './errors.ts'
import { PLAYBOOKS } from './playbook-content.ts'

interface PlaybookSummary {
  name: string
  title: string
  description: string
  whenToUse: string
}

export const listPlaybooks = function listPlaybooks(): PlaybookSummary[] {
  return PLAYBOOKS.map(({ name, title, description, whenToUse }) => ({
    name,
    title,
    description,
    whenToUse,
  }))
}

export const getPlaybook = function getPlaybook(name: string): PlaybookSummary & { content: string } {
  const playbook = PLAYBOOKS.find((selectedPlaybook) => selectedPlaybook.name === name)
  if (!playbook) {
    throw new NotFoundError(`Unknown playbook "${name}"`, {
      validNames: PLAYBOOKS.map((selectedPlaybook) => selectedPlaybook.name),
    })
  }
  return fieldsInOrder([
    ['name', playbook.name],
    ['title', playbook.title],
    ['description', playbook.description],
    ['whenToUse', playbook.whenToUse],
    ['content', playbook.body.trim()],
  ])
}
