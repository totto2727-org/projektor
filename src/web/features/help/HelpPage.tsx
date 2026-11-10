const sections = [
  ['Project', 'A named body of work (e.g. “Website Redesign”). Every issue lives inside a project.'],
  [
    'Issue',
    'A single piece of work — a bug to fix, a feature to build, a task to do. The basic unit everything else is organised around.',
  ],
  [
    'Status',
    'Where an issue is in its life: Backlog (not started) → Todo (ready to start) → In Progress (being worked on) → In Review (done, being checked) → Done.',
  ],
  ['Sprint', 'A fixed time window (often 1–2 weeks) used to plan and track a batch of issues together.'],
  ['Epic', 'A large body of work broken down into several smaller, related issues.'],
  ['Priority', 'How urgent an issue is: Urgent, High, Medium, Low, or None.'],
  ['Groups', 'Teams of members that share the same project access permissions.'],
  ['Tokens', 'API keys that let external tools or AI agents act on your behalf.'],
  [
    'Comments',
    'Discussion and updates attached to an issue — including the completion report an agent or teammate leaves when their work is ready to check.',
  ],
] as const

/** The original help route is intentionally static, so it is fully meaningful in SSR HTML. */
export function HelpPage() {
  return (
    <div className='page-container' style={{ maxWidth: '42rem' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1
          style={{
            margin: '0 0 0.5rem',
            fontSize: '1.5rem',
            fontWeight: 700,
            color: 'var(--text)',
          }}
        >
          Getting started
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9375rem' }}>
          A quick reference for the terms used around Projektor — useful if you're new to this kind of team-planning
          tool.
        </p>
      </header>
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.0625rem', margin: '0 0 0.75rem' }}>Key concepts</h2>
        <dl style={{ margin: 0, display: 'grid', gap: '1rem' }}>
          {sections.map(([term, body]) => (
            <div key={term}>
              <dt style={{ fontWeight: 600, color: 'var(--text-strong)' }}>{term}</dt>
              <dd
                style={{
                  margin: '0.25rem 0 0',
                  color: 'var(--text)',
                  fontSize: '0.9375rem',
                  lineHeight: 1.5,
                }}
              >
                {body}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section>
        <h2 style={{ fontSize: '1.0625rem', margin: '0 0 0.75rem' }}>Typical workflow</h2>
        <ol
          style={{
            margin: 0,
            paddingLeft: '1.25rem',
            color: 'var(--text)',
            fontSize: '0.9375rem',
            lineHeight: 1.7,
          }}
        >
          <li>Someone creates an issue describing work to do.</li>
          <li>Issues are triaged and moved out of the Backlog once they're ready to start.</li>
          <li>Someone — or an AI agent — picks it up and works on it (In Progress).</li>
          <li>When the work's done, it moves to In Review for a check.</li>
          <li>Once accepted, it's marked Done.</li>
        </ol>
      </section>
    </div>
  )
}
