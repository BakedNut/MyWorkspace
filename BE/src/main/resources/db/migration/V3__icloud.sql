INSERT INTO app_document(id,payload) VALUES ('icloud','{}');
CREATE TABLE icloud_range (
  cache_key VARCHAR(64) PRIMARY KEY,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  fetched_at BIGINT NOT NULL,
  accessed_at BIGINT NOT NULL,
  payload LONGTEXT NOT NULL
);
CREATE TABLE icloud_resource (
  id VARCHAR(64) PRIMARY KEY,
  href VARCHAR(2048) NOT NULL,
  etag VARCHAR(1024) NOT NULL,
  read_only BOOLEAN NOT NULL,
  last_seen BIGINT NOT NULL
);
