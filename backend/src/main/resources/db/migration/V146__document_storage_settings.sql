-- Document storage (super admin → Storage): uploaded files go to a SharePoint / OneDrive document library through
-- Microsoft Graph (app registration: tenant, client id, client secret — encrypted) instead of the server's disk.
-- The last upload's result is kept so the super admin can see whether files reach OneDrive.
CREATE TABLE storage_settings (
  id                BIGINT        NOT NULL PRIMARY KEY,
  enabled           BOOLEAN       NOT NULL DEFAULT FALSE,
  tenant_id         VARCHAR(64)   NULL,
  client_id         VARCHAR(64)   NULL,
  client_secret_enc TEXT          NULL,
  secret_expires    DATE          NULL,
  site_url          VARCHAR(500)  NULL,
  library           VARCHAR(200)  NULL,
  folder            VARCHAR(300)  NULL,
  site_id           VARCHAR(300)  NULL,
  drive_id          VARCHAR(200)  NULL,
  folder_url        VARCHAR(1000) NULL,
  last_upload_at    DATETIME      NULL,
  last_upload_name  VARCHAR(500)  NULL,
  last_upload_ok    BOOLEAN       NULL,
  last_upload_error VARCHAR(1000) NULL,
  updated_by        VARCHAR(120)  NULL,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
