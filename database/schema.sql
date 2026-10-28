-- Reference SQLite schema for the Swords of Glory Moderator Portal.
-- The application creates its database and tables automatically from app.py.
-- Do not import this file when the app has already initialized a database.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user (
    id INTEGER PRIMARY KEY,
    username VARCHAR(80) NOT NULL UNIQUE,
    display_name VARCHAR(120) NOT NULL DEFAULT '',
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(24) NOT NULL DEFAULT 'viewer',
    active BOOLEAN NOT NULL DEFAULT 1,
    can_moderate BOOLEAN NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_user_username ON user (username);

CREATE TABLE IF NOT EXISTS form (
    id INTEGER PRIMARY KEY,
    name VARCHAR(180) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    is_public BOOLEAN NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    owner_id INTEGER NOT NULL REFERENCES user(id),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_form_slug ON form (slug);

CREATE TABLE IF NOT EXISTS form_field (
    id INTEGER PRIMARY KEY,
    form_id INTEGER NOT NULL REFERENCES form(id) ON DELETE CASCADE,
    field_key VARCHAR(80) NOT NULL UNIQUE,
    label VARCHAR(180) NOT NULL,
    field_type VARCHAR(24) NOT NULL DEFAULT 'text',
    required BOOLEAN NOT NULL DEFAULT 0,
    options TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_form_field_form_id ON form_field (form_id);

CREATE TABLE IF NOT EXISTS form_permission (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    form_id INTEGER NOT NULL REFERENCES form(id) ON DELETE CASCADE,
    can_read BOOLEAN NOT NULL DEFAULT 0,
    can_results BOOLEAN NOT NULL DEFAULT 0,
    can_edit BOOLEAN NOT NULL DEFAULT 0,
    can_manage BOOLEAN NOT NULL DEFAULT 0,
    CONSTRAINT uq_form_permission_user_form UNIQUE (user_id, form_id)
);

CREATE TABLE IF NOT EXISTS submission (
    id INTEGER PRIMARY KEY,
    form_id INTEGER NOT NULL REFERENCES form(id) ON DELETE CASCADE,
    data_json TEXT NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'pending',
    review_note TEXT NOT NULL DEFAULT '',
    submitted_at DATETIME NOT NULL,
    reviewed_by INTEGER REFERENCES user(id),
    reviewed_at DATETIME
);
CREATE INDEX IF NOT EXISTS ix_submission_form_id ON submission (form_id);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES user(id),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(80) NOT NULL DEFAULT '',
    entity_id VARCHAR(80) NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_log_created_at ON audit_log (created_at);

CREATE TABLE IF NOT EXISTS moderation_action (
    id INTEGER PRIMARY KEY,
    action_type VARCHAR(20) NOT NULL,
    player_uid VARCHAR(100) NOT NULL,
    player_name VARCHAR(120) NOT NULL DEFAULT '',
    server VARCHAR(100) NOT NULL,
    duration VARCHAR(30) NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'pending',
    result_note TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL REFERENCES user(id),
    updated_by INTEGER REFERENCES user(id),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_moderation_action_created_by ON moderation_action (created_by);
