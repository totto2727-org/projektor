ALTER TABLE attachments ADD COLUMN review_status TEXT
  CHECK (review_status IS NULL OR (entity_type = 'issue' AND kind IN ('file', 'url')
    AND review_status IN ('fixing', 'in_review', 'changes_requested', 'done')));
