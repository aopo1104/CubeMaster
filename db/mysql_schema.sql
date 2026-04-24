-- CubeMaster request/response log table
-- MySQL 8.0+

CREATE DATABASE IF NOT EXISTS cubemaster
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE cubemaster;

CREATE TABLE IF NOT EXISTS api_io_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  input_json JSON NOT NULL,
  output_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB;

-- Optional sanity checks for valid JSON values
ALTER TABLE api_io_logs
  ADD CONSTRAINT chk_input_json_valid CHECK (JSON_VALID(input_json)),
  ADD CONSTRAINT chk_output_json_valid CHECK (JSON_VALID(output_json));

-- Example inserts
INSERT INTO api_io_logs (input_json, output_json)
VALUES
(
  JSON_OBJECT('document', JSON_OBJECT('title', 'demo-1'), 'cargoes', JSON_ARRAY()),
  JSON_OBJECT('status', 'succeed', 'loadSummary', JSON_OBJECT('containersLoaded', 1))
),
(
  JSON_OBJECT('document', JSON_OBJECT('title', 'demo-2'), 'cargoes', JSON_ARRAY(JSON_OBJECT('name', 'SKU-001', 'qty', 10))),
  JSON_OBJECT('status', 'succeed', 'loadSummary', JSON_OBJECT('containersLoaded', 2))
);

-- Query latest 20 logs
SELECT id, created_at, input_json, output_json
FROM api_io_logs
ORDER BY created_at DESC
LIMIT 20;
