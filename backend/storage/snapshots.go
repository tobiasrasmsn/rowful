package storage

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"rowful/models"
)

const (
	defaultSnapshotIntervalHours = 24
	defaultSnapshotRetention     = 14
	maxSnapshotRunHistory        = 50
)

func (s *Store) migrateSnapshotTables() error {
	const schema = `
CREATE TABLE IF NOT EXISTS snapshot_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  endpoint TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  bucket TEXT NOT NULL DEFAULT '',
  prefix TEXT NOT NULL DEFAULT '',
  access_key_id TEXT NOT NULL DEFAULT '',
  secret_access_key_encrypted TEXT NOT NULL DEFAULT '',
  use_path_style INTEGER NOT NULL DEFAULT 0,
  schedule_interval_hours INTEGER NOT NULL DEFAULT 24,
  retention_count INTEGER NOT NULL DEFAULT 14,
  last_snapshot_at TEXT NOT NULL DEFAULT '',
  last_success_at TEXT NOT NULL DEFAULT '',
  next_run_at TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshot_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  object_key TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT ''
);
`

	if _, err := s.db.Exec(schema); err != nil {
		return fmt.Errorf("create snapshot schema: %w", err)
	}
	if _, err := s.db.Exec(`
INSERT INTO snapshot_settings(
  id, enabled, endpoint, region, bucket, prefix, access_key_id,
  secret_access_key_encrypted, use_path_style, schedule_interval_hours,
  retention_count, last_snapshot_at, last_success_at, next_run_at, last_error, updated_at
)
VALUES(1, 0, '', '', '', '', '', '', 0, ?, ?, '', '', '', '', ?)
ON CONFLICT(id) DO NOTHING
`, defaultSnapshotIntervalHours, defaultSnapshotRetention, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		return fmt.Errorf("seed snapshot settings: %w", err)
	}
	if _, err := s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_snapshot_runs_started_at ON snapshot_runs(started_at DESC);`); err != nil {
		return fmt.Errorf("create snapshot run index: %w", err)
	}
	if _, err := s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_snapshot_runs_status ON snapshot_runs(status);`); err != nil {
		return fmt.Errorf("create snapshot status index: %w", err)
	}
	return nil
}

func (s *Store) GetSnapshotSettings() (models.SnapshotSettings, error) {
	var settings models.SnapshotSettings
	var enabled int
	var usePathStyle int
	var encryptedSecret string
	var lastSnapshotAt string
	var lastSuccessAt string
	var nextRunAt string
	var updatedAt string
	err := s.db.QueryRow(`
SELECT enabled, endpoint, region, bucket, prefix, access_key_id, secret_access_key_encrypted,
       use_path_style, schedule_interval_hours, retention_count, last_snapshot_at,
       last_success_at, next_run_at, last_error, updated_at
FROM snapshot_settings
WHERE id = 1
`).Scan(
		&enabled,
		&settings.Endpoint,
		&settings.Region,
		&settings.Bucket,
		&settings.Prefix,
		&settings.AccessKeyID,
		&encryptedSecret,
		&usePathStyle,
		&settings.ScheduleIntervalHours,
		&settings.RetentionCount,
		&lastSnapshotAt,
		&lastSuccessAt,
		&nextRunAt,
		&settings.LastError,
		&updatedAt,
	)
	if err != nil {
		return models.SnapshotSettings{}, fmt.Errorf("load snapshot settings: %w", err)
	}

	settings.Enabled = enabled == 1
	settings.UsePathStyle = usePathStyle == 1
	settings.Endpoint = strings.TrimSpace(settings.Endpoint)
	settings.Region = strings.TrimSpace(settings.Region)
	settings.Bucket = strings.TrimSpace(settings.Bucket)
	settings.Prefix = normalizeSnapshotPrefix(settings.Prefix)
	settings.AccessKeyID = strings.TrimSpace(settings.AccessKeyID)
	settings.HasSecretAccessKey = strings.TrimSpace(encryptedSecret) != ""
	if settings.ScheduleIntervalHours <= 0 {
		settings.ScheduleIntervalHours = defaultSnapshotIntervalHours
	}
	if settings.RetentionCount <= 0 {
		settings.RetentionCount = defaultSnapshotRetention
	}
	if settings.HasSecretAccessKey {
		decrypted, decryptErr := s.secrets.decryptString(encryptedSecret)
		if decryptErr != nil {
			return models.SnapshotSettings{}, fmt.Errorf("decrypt snapshot secret: %w", decryptErr)
		}
		settings.SecretAccessKey = decrypted
	}
	settings.LastSnapshotAt = parseOptionalTime(lastSnapshotAt)
	settings.LastSuccessAt = parseOptionalTime(lastSuccessAt)
	settings.NextRunAt = parseOptionalTime(nextRunAt)
	settings.UpdatedAt = parseTimeOrNow(updatedAt)
	return settings, nil
}

func (s *Store) UpdateSnapshotSettings(settings models.SnapshotSettings) (models.SnapshotSettings, error) {
	normalized := normalizeSnapshotSettings(settings)

	current, err := s.GetSnapshotSettings()
	if err != nil {
		return models.SnapshotSettings{}, err
	}

	secret := strings.TrimSpace(normalized.SecretAccessKey)
	switch {
	case secret == "" && current.HasSecretAccessKey && normalized.HasSecretAccessKey:
		secret = current.SecretAccessKey
	case !normalized.HasSecretAccessKey:
		secret = ""
	}

	encryptedSecret := ""
	if secret != "" {
		encryptedSecret, err = s.secrets.encryptString(secret)
		if err != nil {
			return models.SnapshotSettings{}, fmt.Errorf("encrypt snapshot secret: %w", err)
		}
	}

	now := time.Now().UTC()
	if _, err := s.db.Exec(`
UPDATE snapshot_settings
SET enabled = ?, endpoint = ?, region = ?, bucket = ?, prefix = ?, access_key_id = ?,
    secret_access_key_encrypted = ?, use_path_style = ?, schedule_interval_hours = ?,
    retention_count = ?, updated_at = ?
WHERE id = 1
`,
		boolToInt(normalized.Enabled),
		normalized.Endpoint,
		normalized.Region,
		normalized.Bucket,
		normalized.Prefix,
		normalized.AccessKeyID,
		encryptedSecret,
		boolToInt(normalized.UsePathStyle),
		normalized.ScheduleIntervalHours,
		normalized.RetentionCount,
		now.Format(time.RFC3339Nano),
	); err != nil {
		return models.SnapshotSettings{}, fmt.Errorf("update snapshot settings: %w", err)
	}

	updated, err := s.GetSnapshotSettings()
	if err != nil {
		return models.SnapshotSettings{}, err
	}
	return updated, nil
}

func (s *Store) UpdateSnapshotSchedule(nextRunAt *time.Time) error {
	formatted := ""
	if nextRunAt != nil {
		formatted = nextRunAt.UTC().Format(time.RFC3339Nano)
	}
	if _, err := s.db.Exec(`
UPDATE snapshot_settings
SET next_run_at = ?, updated_at = ?
WHERE id = 1
`, formatted, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		return fmt.Errorf("update snapshot schedule: %w", err)
	}
	return nil
}

func (s *Store) CreateSnapshotRun(trigger string) (models.SnapshotRun, error) {
	run := models.SnapshotRun{
		ID:        uuid.NewString(),
		Status:    models.SnapshotStatusRunning,
		Trigger:   strings.TrimSpace(trigger),
		StartedAt: time.Now().UTC(),
	}
	if run.Trigger == "" {
		run.Trigger = models.SnapshotTriggerManual
	}

	if _, err := s.db.Exec(`
INSERT INTO snapshot_runs(id, status, trigger_type, object_key, size_bytes, error_message, started_at, completed_at)
VALUES(?, ?, ?, '', 0, '', ?, '')
`, run.ID, run.Status, run.Trigger, run.StartedAt.Format(time.RFC3339Nano)); err != nil {
		return models.SnapshotRun{}, fmt.Errorf("create snapshot run: %w", err)
	}
	return run, nil
}

func (s *Store) FinalizeSnapshotRun(run models.SnapshotRun, nextRunAt *time.Time) error {
	completedAt := ""
	if run.CompletedAt != nil {
		completedAt = run.CompletedAt.UTC().Format(time.RFC3339Nano)
	}
	nextRun := ""
	if nextRunAt != nil {
		nextRun = nextRunAt.UTC().Format(time.RFC3339Nano)
	}

	lastSnapshotAt := completedAt
	lastSuccessAt := ""
	lastError := strings.TrimSpace(run.Error)
	if run.Status == models.SnapshotStatusSuccess && run.CompletedAt != nil {
		lastSuccessAt = completedAt
		lastError = ""
	}

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin snapshot finalize tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.Exec(`
UPDATE snapshot_runs
SET status = ?, object_key = ?, size_bytes = ?, error_message = ?, completed_at = ?
WHERE id = ?
`, run.Status, run.ObjectKey, run.SizeBytes, lastError, completedAt, run.ID); err != nil {
		return fmt.Errorf("update snapshot run: %w", err)
	}

	if _, err := tx.Exec(`
UPDATE snapshot_settings
SET last_snapshot_at = ?, last_success_at = CASE WHEN ? != '' THEN ? ELSE last_success_at END,
    next_run_at = ?, last_error = ?, updated_at = ?
WHERE id = 1
`, lastSnapshotAt, lastSuccessAt, lastSuccessAt, nextRun, lastError, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		return fmt.Errorf("update snapshot settings after run: %w", err)
	}

	if _, err := tx.Exec(`
DELETE FROM snapshot_runs
WHERE id IN (
  SELECT id
  FROM snapshot_runs
  ORDER BY started_at DESC
  LIMIT -1 OFFSET ?
)
`, maxSnapshotRunHistory); err != nil {
		return fmt.Errorf("prune snapshot history: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit snapshot finalize tx: %w", err)
	}
	return nil
}

func (s *Store) ListSnapshotRuns(limit int) ([]models.SnapshotRun, error) {
	if limit <= 0 {
		limit = 10
	}

	rows, err := s.db.Query(`
SELECT id, status, trigger_type, object_key, size_bytes, error_message, started_at, completed_at
FROM snapshot_runs
ORDER BY started_at DESC
LIMIT ?
`, limit)
	if err != nil {
		return nil, fmt.Errorf("query snapshot runs: %w", err)
	}
	defer func() { _ = rows.Close() }()

	runs := make([]models.SnapshotRun, 0, limit)
	for rows.Next() {
		var run models.SnapshotRun
		var startedAt string
		var completedAt string
		if err := rows.Scan(
			&run.ID,
			&run.Status,
			&run.Trigger,
			&run.ObjectKey,
			&run.SizeBytes,
			&run.Error,
			&startedAt,
			&completedAt,
		); err != nil {
			return nil, fmt.Errorf("scan snapshot run: %w", err)
		}
		run.StartedAt = parseTimeOrNow(startedAt)
		run.CompletedAt = parseOptionalTime(completedAt)
		runs = append(runs, run)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate snapshot runs: %w", err)
	}
	return runs, nil
}

func (s *Store) MarkRunningSnapshotRunsFailed(message string) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := s.db.Exec(`
UPDATE snapshot_runs
SET status = ?, error_message = CASE
      WHEN error_message = '' THEN ?
      ELSE error_message
    END,
    completed_at = CASE
      WHEN completed_at = '' THEN ?
      ELSE completed_at
    END
WHERE status = ?
`, models.SnapshotStatusFailed, strings.TrimSpace(message), now, models.SnapshotStatusRunning); err != nil {
		return fmt.Errorf("mark running snapshot runs failed: %w", err)
	}
	return nil
}

func (s *Store) DeleteRunningSnapshotRuns() error {
	if _, err := s.db.Exec(`
DELETE FROM snapshot_runs
WHERE status = ?
`, models.SnapshotStatusRunning); err != nil {
		return fmt.Errorf("delete running snapshot runs: %w", err)
	}
	return nil
}

func (s *Store) ReplaceSnapshotRuns(runs []models.SnapshotRun) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin snapshot run replace tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.Exec(`DELETE FROM snapshot_runs`); err != nil {
		return fmt.Errorf("clear snapshot runs: %w", err)
	}

	insertStmt, err := tx.Prepare(`
INSERT INTO snapshot_runs(id, status, trigger_type, object_key, size_bytes, error_message, started_at, completed_at)
VALUES(?, ?, ?, ?, ?, ?, ?, ?)
`)
	if err != nil {
		return fmt.Errorf("prepare snapshot run insert: %w", err)
	}
	defer func() { _ = insertStmt.Close() }()

	limit := len(runs)
	if limit > maxSnapshotRunHistory {
		limit = maxSnapshotRunHistory
	}
	for index := 0; index < limit; index++ {
		run := runs[index]
		completedAt := ""
		if run.CompletedAt != nil {
			completedAt = run.CompletedAt.UTC().Format(time.RFC3339Nano)
		}
		if _, err := insertStmt.Exec(
			run.ID,
			run.Status,
			run.Trigger,
			run.ObjectKey,
			run.SizeBytes,
			strings.TrimSpace(run.Error),
			run.StartedAt.UTC().Format(time.RFC3339Nano),
			completedAt,
		); err != nil {
			return fmt.Errorf("insert snapshot run %s: %w", run.ID, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit snapshot run replace tx: %w", err)
	}
	return nil
}

func (s *Store) GetSnapshotRun(id string) (models.SnapshotRun, error) {
	var run models.SnapshotRun
	var startedAt string
	var completedAt string
	err := s.db.QueryRow(`
SELECT id, status, trigger_type, object_key, size_bytes, error_message, started_at, completed_at
FROM snapshot_runs
WHERE id = ?
`, strings.TrimSpace(id)).Scan(
		&run.ID,
		&run.Status,
		&run.Trigger,
		&run.ObjectKey,
		&run.SizeBytes,
		&run.Error,
		&startedAt,
		&completedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.SnapshotRun{}, ErrNotFound
		}
		return models.SnapshotRun{}, fmt.Errorf("load snapshot run: %w", err)
	}
	run.StartedAt = parseTimeOrNow(startedAt)
	run.CompletedAt = parseOptionalTime(completedAt)
	return run, nil
}

func normalizeSnapshotSettings(settings models.SnapshotSettings) models.SnapshotSettings {
	normalized := settings
	normalized.Endpoint = strings.TrimRight(strings.TrimSpace(normalized.Endpoint), "/")
	normalized.Region = strings.TrimSpace(normalized.Region)
	normalized.Bucket = strings.TrimSpace(normalized.Bucket)
	normalized.Prefix = normalizeSnapshotPrefix(normalized.Prefix)
	normalized.AccessKeyID = strings.TrimSpace(normalized.AccessKeyID)
	normalized.SecretAccessKey = strings.TrimSpace(normalized.SecretAccessKey)
	if normalized.ScheduleIntervalHours <= 0 {
		normalized.ScheduleIntervalHours = defaultSnapshotIntervalHours
	}
	if normalized.ScheduleIntervalHours > 24*30 {
		normalized.ScheduleIntervalHours = 24 * 30
	}
	if normalized.RetentionCount <= 0 {
		normalized.RetentionCount = defaultSnapshotRetention
	}
	if normalized.RetentionCount > 365 {
		normalized.RetentionCount = 365
	}
	return normalized
}

func normalizeSnapshotPrefix(prefix string) string {
	trimmed := strings.TrimSpace(prefix)
	trimmed = strings.Trim(trimmed, "/")
	return trimmed
}

func parseOptionalTime(value string) *time.Time {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	parsed := parseTimeOrNow(trimmed)
	return &parsed
}
