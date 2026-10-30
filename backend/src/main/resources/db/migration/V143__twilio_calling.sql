-- Browser calling through Twilio (admin → Calling): an organization's Twilio account (secrets encrypted) and the calls
-- placed from Payer Submission (the payer's answer: completed / busy / no-answer / failed / canceled, and the length).
CREATE TABLE org_calling_settings (
  org_id             BIGINT       NOT NULL PRIMARY KEY,
  enabled            BOOLEAN      NOT NULL DEFAULT FALSE,
  account_sid        VARCHAR(64)  NULL,
  api_key_sid        VARCHAR(64)  NULL,
  api_key_secret_enc TEXT         NULL,
  auth_token_enc     TEXT         NULL,
  phone_number       VARCHAR(20)  NULL,
  twiml_app_sid      VARCHAR(64)  NULL,
  updated_by         VARCHAR(120) NULL,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_calling_account (account_sid),
  CONSTRAINT fk_calling_org FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE call_session (
  call_sid      VARCHAR(64) NOT NULL PRIMARY KEY,
  org_id        BIGINT      NOT NULL,
  enrollment_id BIGINT      NULL,
  user_id       BIGINT      NULL,
  to_number     VARCHAR(20) NULL,
  dial_status   VARCHAR(20) NULL,
  dial_duration INT         NULL,
  created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_call_session_org (org_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
