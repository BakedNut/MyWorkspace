CREATE TABLE app_document (
  id VARCHAR(96) PRIMARY KEY,
  payload LONGTEXT NOT NULL
);
INSERT INTO app_document(id,payload) VALUES
('timetable','{"semesterStart":"2026-09-01","semesterEnd":"2026-12-31","courses":[]}'),
('wol','[{"id":"my-pc","name":"내 PC","mac":null},{"id":"brother-pc","name":"형 PC","mac":null}]');
CREATE TABLE calendar_event (
  id VARCHAR(64) PRIMARY KEY,
  event_date DATE NOT NULL,
  payload LONGTEXT NOT NULL,
  INDEX event_date_idx(event_date)
);
CREATE TABLE metric_sample (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  sampled_at BIGINT NOT NULL,
  resource_id VARCHAR(32) NOT NULL,
  cpu DOUBLE,
  ram DOUBLE,
  net_input DOUBLE,
  net_output DOUBLE,
  disk DOUBLE,
  keep_minute BOOLEAN NOT NULL DEFAULT FALSE,
  INDEX metric_time_idx(sampled_at),
  INDEX metric_resource_time_idx(resource_id,sampled_at)
);
CREATE TABLE wol_request (
  device_id VARCHAR(64) PRIMARY KEY,
  sent_at BIGINT NOT NULL
);
