-- Notes on every provider document and enrollment: why a document is still pending / on hold, what the payer said on the
-- phone or by email. Who wrote the latest note and when is kept beside it.

ALTER TABLE provider_document
  ADD COLUMN notes            TEXT         NULL,
  ADD COLUMN notes_updated_at DATETIME     NULL,
  ADD COLUMN notes_updated_by VARCHAR(120) NULL;

ALTER TABLE provider_additional_document
  MODIFY COLUMN notes         TEXT         NULL,
  ADD COLUMN notes_updated_at DATETIME     NULL,
  ADD COLUMN notes_updated_by VARCHAR(120) NULL;

ALTER TABLE enrollment
  ADD COLUMN notes_updated_at DATETIME     NULL,
  ADD COLUMN notes_updated_by VARCHAR(120) NULL;

-- the payer's acknowledgement / approval certificate is uploaded as an enrollment file of type 'acknowledgement'
