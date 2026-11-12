CREATE TABLE shortcut_icon (
    site_key VARCHAR(64) PRIMARY KEY,
    media_type VARCHAR(32),
    image_bytes LONGBLOB,
    checked_at BIGINT NOT NULL
);
