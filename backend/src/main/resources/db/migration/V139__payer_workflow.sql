-- Payer submission workflow (commercial / Medicare / Medicaid steps per assigned payer) and payer support contacts.

-- payers: the support line and mailbox used by the Call / Email buttons of the payer cards
ALTER TABLE payer
  ADD COLUMN support_email VARCHAR(255) NULL,
  ADD COLUMN support_phone VARCHAR(20)  NULL;

-- the provider-payer workflow lives on the enrollment (an assigned payer = an enrollment)
ALTER TABLE enrollment
  ADD COLUMN wf_step         INT          NOT NULL DEFAULT 0,
  ADD COLUMN wf_method       VARCHAR(10)  NULL,
  ADD COLUMN wf_tasks        TEXT         NULL,
  ADD COLUMN wf_fields       TEXT         NULL,
  ADD COLUMN wf_docs         TEXT         NULL,
  ADD COLUMN wf_step_started TEXT         NULL;

-- activity of the workflow: calls, emails, steps, checklist items, details and files
CREATE TABLE enrollment_workflow_log (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  org_id          BIGINT        NOT NULL,
  enrollment_id   BIGINT        NOT NULL,
  log_type        VARCHAR(10)   NOT NULL,
  text            VARCHAR(2000) NOT NULL,
  call_outcome    VARCHAR(40)   NULL,
  call_ref        VARCHAR(120)  NULL,
  call_minutes    INT           NULL,
  email_to        VARCHAR(255)  NULL,
  email_subject   VARCHAR(255)  NULL,
  email_status    VARCHAR(20)   NULL,
  created_by      BIGINT        NULL,
  created_by_name VARCHAR(120)  NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_wflog_enrollment (enrollment_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
