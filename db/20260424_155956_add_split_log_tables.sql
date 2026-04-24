-- Generated at: 2026-04-24 15:59:56
-- Purpose: split log tables for pallet and pallet2ctn flows

USE cubemaster;

CREATE TABLE IF NOT EXISTS pallet_load_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  input_json JSON NOT NULL,
  output_json JSON NOT NULL,
  response_status INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_created_at (created_at),
  CHECK (JSON_VALID(input_json)),
  CHECK (JSON_VALID(output_json))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS pallet2ctn_load_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  flow_id VARCHAR(64) NOT NULL,
  step1_input_json JSON NULL,
  step1_output_json JSON NULL,
  step2_input_json JSON NULL,
  step2_output_json JSON NULL,
  step1_status INT NULL,
  step2_status INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_flow_id (flow_id),
  INDEX idx_created_at (created_at),
  CHECK (step1_input_json IS NULL OR JSON_VALID(step1_input_json)),
  CHECK (step1_output_json IS NULL OR JSON_VALID(step1_output_json)),
  CHECK (step2_input_json IS NULL OR JSON_VALID(step2_input_json)),
  CHECK (step2_output_json IS NULL OR JSON_VALID(step2_output_json))
) ENGINE=InnoDB;
