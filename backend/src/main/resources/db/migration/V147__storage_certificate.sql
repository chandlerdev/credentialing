-- Storage → OneDrive sign-in with a certificate (Entra ID app registration → Certificates): the private key (encrypted)
-- and the certificate, its thumbprint, subject and expiry. auth_method: secret | certificate.
ALTER TABLE storage_settings
  ADD COLUMN auth_method     VARCHAR(20)  NULL,
  ADD COLUMN cert_key_enc    TEXT         NULL,
  ADD COLUMN cert_der        TEXT         NULL,
  ADD COLUMN cert_thumbprint VARCHAR(64)  NULL,
  ADD COLUMN cert_subject    VARCHAR(300) NULL,
  ADD COLUMN cert_expires    DATE         NULL;
