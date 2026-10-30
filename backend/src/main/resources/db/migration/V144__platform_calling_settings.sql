-- Calling is set up once by the super admin (Communication) for every organization: one platform-wide Twilio account.
DELETE FROM org_calling_settings;
ALTER TABLE org_calling_settings DROP FOREIGN KEY fk_calling_org;
RENAME TABLE org_calling_settings TO calling_settings;
ALTER TABLE calling_settings CHANGE org_id id BIGINT NOT NULL;
