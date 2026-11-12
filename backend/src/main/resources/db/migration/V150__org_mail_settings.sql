-- Each organization sends its email through its own mail account (super admin → Organizations → Email Settings) and
-- payer replies are read from that account's own inbox. There is no shared fallback: an organization without its
-- own account set up cannot send email (the user gets an error).
-- smtp_security / imap_security: starttls | ssl | none. The password (one for both servers) is encrypted.
CREATE TABLE org_mail_settings (
  org_id          BIGINT       NOT NULL PRIMARY KEY,
  enabled         TINYINT(1)   NOT NULL DEFAULT 0,
  from_name       VARCHAR(120) NULL,
  from_email      VARCHAR(255) NULL,
  smtp_host       VARCHAR(255) NULL,
  smtp_port       INT          NULL,
  smtp_security   VARCHAR(10)  NULL,
  username        VARCHAR(255) NULL,
  password_enc    TEXT         NULL,
  imap_enabled    TINYINT(1)   NOT NULL DEFAULT 0,
  imap_host       VARCHAR(255) NULL,
  imap_port       INT          NULL,
  imap_security   VARCHAR(10)  NULL,
  imap_folder     VARCHAR(120) NULL,
  last_inbox_check_at DATETIME NULL,
  last_inbox_error    VARCHAR(500) NULL,
  updated_by      BIGINT       NULL,
  updated_at      DATETIME     NULL,
  CONSTRAINT fk_org_mail_org FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
