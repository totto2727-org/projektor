-- A head survives draft deletion so a delayed writer cannot recreate discarded work.
CREATE TABLE wiki_draft_heads (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  revision TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id, page_id)
);
