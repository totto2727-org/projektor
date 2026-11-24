import { NotFoundError } from './errors.ts'
import { PLAYBOOKS } from './playbook-content.ts'

export function listPlaybooks() {
  return PLAYBOOKS.map(({ name, title, description, whenToUse }) => ({
    name,
    title,
    description,
    whenToUse,
  }))
}

export function getPlaybook(name: string) {
  const playbook = PLAYBOOKS.find((p) => p.name === name)
  if (!playbook) {
    throw new NotFoundError(`Unknown playbook "${name}"`, {
      validNames: PLAYBOOKS.map((p) => p.name),
    })
  }
  return {
    name: playbook.name,
    title: playbook.title,
    description: playbook.description,
    whenToUse: playbook.whenToUse,
    content: playbook.body.trim(),
  }
}
