-- Organization → practices → locations: the "client" level is no longer used (a practice belongs directly to the
-- organization). Existing clients stay in the table, unused; new practices have no client.
ALTER TABLE practice MODIFY client_id BIGINT NULL;
