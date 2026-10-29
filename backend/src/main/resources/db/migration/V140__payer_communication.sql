-- Payer communication: the call status (attended or not), the email details (sender, message, Message-ID to match the
-- payer's replies) and the communication templates (Custom Templates → Payer Communication; the 8 built-in ones below).
ALTER TABLE email_template
  ADD COLUMN code VARCHAR(40) NULL;

ALTER TABLE enrollment_workflow_log
  ADD COLUMN call_attended BOOLEAN      NULL,
  ADD COLUMN email_from    VARCHAR(255) NULL,
  ADD COLUMN email_body    TEXT         NULL,
  ADD COLUMN message_id    VARCHAR(255) NULL,
  ADD KEY idx_wflog_message (message_id);

INSERT INTO email_template (org_id, type, code, name, subject, body) VALUES
(NULL, 'payer_communication', 'new_application', 'Request participation / application',
 'Participation request - {{provider_name}}, {{credentials}} (NPI {{npi}})',
 'Hello {{payer_name}} Provider Network Team,

We would like to add the provider below to our group''s participation with {{payer_name}}. Please confirm the network is open and send the next steps or application.

Provider: {{provider_name}}, {{credentials}}
Specialty: {{specialty}}
Individual NPI: {{npi}}
Group NPI: {{group_npi}}
TIN: {{tin}}
CAQH ID: {{caqh_id}} (current and attested)
Practice: {{practice}}
Location: {{address}}

Thank you,
{{sender_name}}'),
(NULL, 'payer_communication', 'caqh_access', 'CAQH profile ready',
 'CAQH profile ready - {{provider_name}} (CAQH {{caqh_id}})',
 'Hello,

{{provider_name}}''s CAQH ProView profile (CAQH ID {{caqh_id}}) has been updated, re-attested, and {{payer_name}} is authorized to view it.

Case #: {{case_no}}

Please proceed with credentialing and let us know if anything else is needed.

Thank you,
{{sender_name}}'),
(NULL, 'payer_communication', 'submission_confirm', 'Confirm receipt & completeness',
 'Confirmation of receipt - {{provider_name}} (NPI {{npi}})',
 'Hello,

We submitted the application for {{provider_name}} (NPI {{npi}}) on {{submitted_date}}.

Could you please confirm it was received and is complete, and share the reference number?

Thank you,
{{sender_name}}'),
(NULL, 'payer_communication', 'status_followup', 'Status follow-up',
 'Status follow-up - {{provider_name}}, Ref {{reference_no}}',
 'Hello,

I''m following up on the application for {{provider_name}} (NPI {{npi}}).

Reference #: {{reference_no}}
Submitted: {{submitted_date}}
Days since submission: {{days_since_submit}}

Could you share the current status, the committee date if scheduled, and an estimated completion date?

Thank you,
{{sender_name}}'),
(NULL, 'payer_communication', 'missing_docs', 'Response to missing-information request',
 'Requested information - {{provider_name}}, Ref {{reference_no}}',
 'Hello,

Attached is the information requested for {{provider_name}} (NPI {{npi}}), reference #{{reference_no}}:

- 

Please confirm receipt and let us know if anything else is needed.

Thank you,
{{sender_name}}'),
(NULL, 'payer_communication', 'contract_followup', 'Contract / fee schedule follow-up',
 'Agreement status - {{provider_name}} / {{practice}}',
 'Hello,

Credentialing for {{provider_name}} (NPI {{npi}}) is complete. Could you please send the participation agreement and fee schedule, or confirm the provider has been added to our existing group agreement (TIN {{tin}})?

Thank you,
{{sender_name}}'),
(NULL, 'payer_communication', 'approval_details', 'Request effective date & provider ID',
 'Effective date & provider ID - {{provider_name}}',
 'Hello,

Thank you for approving {{provider_name}} (NPI {{npi}}). Please confirm the effective date and assigned provider ID, and send the fully executed agreement and welcome letter.

Thank you,
{{sender_name}}'),
(NULL, 'payer_communication', 'recred_notice', 'Recredentialing / revalidation',
 'Recredentialing - {{provider_name}} (NPI {{npi}})',
 'Hello,

{{provider_name}} (NPI {{npi}}, provider ID {{payer_provider_id}}) is approaching the recredentialing / revalidation date. The CAQH profile (ID {{caqh_id}}) is current and attested. Please let us know if any forms are needed.

Thank you,
{{sender_name}}');
