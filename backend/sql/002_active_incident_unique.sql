
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_incident_service_title
ON incidents (service_id, title)
WHERE status IN ('OPEN', 'INVESTIGATING');
