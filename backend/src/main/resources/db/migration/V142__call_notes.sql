-- Call follow-ups: the call's notes and the next follow-up it set, kept apart from the log text (shown on their own lines).
ALTER TABLE enrollment_workflow_log
  ADD COLUMN call_notes     VARCHAR(1500) NULL,
  ADD COLUMN next_follow_up DATE          NULL;
