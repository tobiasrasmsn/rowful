package storage

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"rowful/models"
)

func (s *Store) migrateAuthTables() error {
	const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS signup_allowlist (
  email TEXT PRIMARY KEY,
  invited_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  claimed_by TEXT,
  claimed_at TEXT,
  FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (claimed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS workbook_users (
  workbook_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workbook_id) REFERENCES workbooks(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`

	if _, err := s.db.Exec(schema); err != nil {
		return fmt.Errorf("create auth schema: %w", err)
	}
	if _, err := s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);`); err != nil {
		return fmt.Errorf("create users index: %w", err)
	}
	if _, err := s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);`); err != nil {
		return fmt.Errorf("create session user index: %w", err)
	}
	if _, err := s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);`); err != nil {
		return fmt.Errorf("create session expiry index: %w", err)
	}
	if _, err := s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_signup_allowlist_invited_by ON signup_allowlist(invited_by);`); err != nil {
		return fmt.Errorf("create allowlist inviter index: %w", err)
	}
	if _, err := s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_signup_allowlist_claimed_by ON signup_allowlist(claimed_by);`); err != nil {
		return fmt.Errorf("create allowlist claimer index: %w", err)
	}
	if _, err := s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_workbook_users_user_id ON workbook_users(user_id);`); err != nil {
		return fmt.Errorf("create workbook_users user index: %w", err)
	}
	return nil
}

func ScopeFileHash(userID, rawHash string) string {
	hash := sha256.Sum256([]byte(userID + ":" + rawHash))
	return hex.EncodeToString(hash[:])
}

func (s *Store) GetBootstrapState() (models.AuthBootstrap, error) {
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		return models.AuthBootstrap{}, fmt.Errorf("count users: %w", err)
	}
	return models.AuthBootstrap{
		SetupRequired: count == 0,
		InviteOnly:    false,
	}, nil
}

func (s *Store) CreateUser(name, email, passwordHash string) (models.AuthUser, error) {
	normalizedEmail := normalizeEmail(email)
	normalizedName := normalizeName(name, normalizedEmail)
	now := time.Now().UTC()

	tx, err := s.db.Begin()
	if err != nil {
		return models.AuthUser{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var userCount int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&userCount); err != nil {
		return models.AuthUser{}, fmt.Errorf("count users: %w", err)
	}
	var existingID string
	err = tx.QueryRow(`SELECT id FROM users WHERE email = ?`, normalizedEmail).Scan(&existingID)
	if err == nil {
		return models.AuthUser{}, ErrConflict
	}
	if err != nil && err != sql.ErrNoRows {
		return models.AuthUser{}, fmt.Errorf("check existing user: %w", err)
	}

	isAdmin := userCount == 0

	user := models.AuthUser{
		ID:        uuid.NewString(),
		Name:      normalizedName,
		Email:     normalizedEmail,
		IsAdmin:   isAdmin,
		CreatedAt: now,
	}
	if _, err := tx.Exec(`
INSERT INTO users(id, email, name, password_hash, is_admin, created_at)
VALUES(?, ?, ?, ?, ?, ?)
`, user.ID, user.Email, user.Name, passwordHash, boolToInt(user.IsAdmin), now.Format(time.RFC3339Nano)); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return models.AuthUser{}, ErrConflict
		}
		return models.AuthUser{}, fmt.Errorf("insert user: %w", err)
	}

	if isAdmin {
		if err := s.claimLegacyWorkbooksTx(tx, user.ID); err != nil {
			return models.AuthUser{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return models.AuthUser{}, fmt.Errorf("commit tx: %w", err)
	}
	return user, nil
}

func (s *Store) claimLegacyWorkbooksTx(tx *sql.Tx, userID string) error {
	rows, err := tx.Query(`
SELECT w.id, w.file_hash
FROM workbooks w
LEFT JOIN workbook_users wu ON wu.workbook_id = w.id
WHERE wu.workbook_id IS NULL
`)
	if err != nil {
		return fmt.Errorf("query legacy workbooks: %w", err)
	}
	defer func() { _ = rows.Close() }()

	type legacyWorkbook struct {
		id       string
		fileHash string
	}
	legacy := make([]legacyWorkbook, 0)
	for rows.Next() {
		var item legacyWorkbook
		if err := rows.Scan(&item.id, &item.fileHash); err != nil {
			return fmt.Errorf("scan legacy workbook: %w", err)
		}
		legacy = append(legacy, item)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate legacy workbooks: %w", err)
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, workbook := range legacy {
		scopedHash := ScopeFileHash(userID, workbook.fileHash)
		if _, err := tx.Exec(`UPDATE workbooks SET file_hash = ? WHERE id = ?`, scopedHash, workbook.id); err != nil {
			return fmt.Errorf("scope legacy workbook hash: %w", err)
		}
		if _, err := tx.Exec(`
INSERT INTO workbook_users(workbook_id, user_id, created_at)
VALUES(?, ?, ?)
ON CONFLICT(workbook_id) DO NOTHING
`, workbook.id, userID, now); err != nil {
			return fmt.Errorf("claim legacy workbook: %w", err)
		}
	}
	return nil
}

func (s *Store) GetUserByEmail(email string) (models.AuthUser, string, error) {
	normalizedEmail := normalizeEmail(email)
	var user models.AuthUser
	var passwordHash, createdAt string
	var isAdmin int
	err := s.db.QueryRow(`
SELECT id, email, name, password_hash, is_admin, created_at
FROM users
WHERE email = ?
`, normalizedEmail).Scan(&user.ID, &user.Email, &user.Name, &passwordHash, &isAdmin, &createdAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.AuthUser{}, "", ErrNotFound
		}
		return models.AuthUser{}, "", fmt.Errorf("load user by email: %w", err)
	}
	user.IsAdmin = isAdmin == 1
	user.CreatedAt = parseTimeOrNow(createdAt)
	return user, passwordHash, nil
}

func (s *Store) CreateSession(userID, tokenHash, csrfToken string, expiresAt time.Time) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := s.db.Exec(`DELETE FROM user_sessions WHERE expires_at <= ?`, now); err != nil {
		return fmt.Errorf("cleanup expired sessions: %w", err)
	}
	if _, err := s.db.Exec(`
INSERT INTO user_sessions(id, user_id, token_hash, csrf_token, expires_at, created_at, last_seen_at)
VALUES(?, ?, ?, ?, ?, ?, ?)
`, uuid.NewString(), userID, tokenHash, csrfToken, expiresAt.UTC().Format(time.RFC3339Nano), now, now); err != nil {
		return fmt.Errorf("insert session: %w", err)
	}
	return nil
}

func (s *Store) GetSessionByTokenHash(tokenHash string) (models.AuthSession, models.AuthUser, error) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	var session models.AuthSession
	var user models.AuthUser
	var sessionCreatedAt, userCreatedAt, lastSeenAt, expiresAt string
	var isAdmin int
	err := s.db.QueryRow(`
SELECT us.id, us.user_id, us.csrf_token, us.expires_at, us.created_at, us.last_seen_at,
       u.id, u.email, u.name, u.is_admin, u.created_at
FROM user_sessions us
JOIN users u ON u.id = us.user_id
WHERE us.token_hash = ? AND us.expires_at > ?
`, tokenHash, now).Scan(
		&session.ID,
		&session.UserID,
		&session.CSRFToken,
		&expiresAt,
		&sessionCreatedAt,
		&lastSeenAt,
		&user.ID,
		&user.Email,
		&user.Name,
		&isAdmin,
		&userCreatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.AuthSession{}, models.AuthUser{}, ErrNotFound
		}
		return models.AuthSession{}, models.AuthUser{}, fmt.Errorf("load session: %w", err)
	}
	user.IsAdmin = isAdmin == 1
	user.CreatedAt = parseTimeOrNow(userCreatedAt)
	session.ExpiresAt = parseTimeOrNow(expiresAt)
	session.CreatedAt = parseTimeOrNow(sessionCreatedAt)
	session.LastSeenAt = parseTimeOrNow(lastSeenAt)
	return session, user, nil
}

func (s *Store) DeleteSessionByTokenHash(tokenHash string) error {
	if _, err := s.db.Exec(`DELETE FROM user_sessions WHERE token_hash = ?`, tokenHash); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	return nil
}

func (s *Store) ListAllowlistEntries() ([]models.AllowlistEntry, error) {
	rows, err := s.db.Query(`
SELECT sa.email, sa.created_at,
       inviter.email,
       sa.claimed_at,
       claimer.email
FROM signup_allowlist sa
JOIN users inviter ON inviter.id = sa.invited_by
LEFT JOIN users claimer ON claimer.id = sa.claimed_by
ORDER BY sa.created_at DESC, sa.email ASC
`)
	if err != nil {
		return nil, fmt.Errorf("query allowlist: %w", err)
	}
	defer func() { _ = rows.Close() }()

	entries := make([]models.AllowlistEntry, 0)
	for rows.Next() {
		var entry models.AllowlistEntry
		var createdAt string
		var invitedByEmail sql.NullString
		var claimedAt sql.NullString
		var claimedByEmail sql.NullString
		if err := rows.Scan(&entry.Email, &createdAt, &invitedByEmail, &claimedAt, &claimedByEmail); err != nil {
			return nil, fmt.Errorf("scan allowlist entry: %w", err)
		}
		entry.CreatedAt = parseTimeOrNow(createdAt)
		entry.InvitedByEmail = invitedByEmail.String
		entry.ClaimedByEmail = claimedByEmail.String
		if claimedAt.Valid {
			parsed := parseTimeOrNow(claimedAt.String)
			entry.ClaimedAt = &parsed
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate allowlist: %w", err)
	}
	return entries, nil
}

func (s *Store) AddAllowlistEntry(email, invitedBy string) (models.AllowlistEntry, error) {
	normalizedEmail := normalizeEmail(email)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := s.db.Exec(`
INSERT INTO signup_allowlist(email, invited_by, created_at)
VALUES(?, ?, ?)
ON CONFLICT(email) DO UPDATE SET
  invited_by = excluded.invited_by,
  created_at = CASE WHEN signup_allowlist.claimed_by IS NULL THEN excluded.created_at ELSE signup_allowlist.created_at END
`, normalizedEmail, invitedBy, now); err != nil {
		return models.AllowlistEntry{}, fmt.Errorf("upsert allowlist entry: %w", err)
	}
	entries, err := s.ListAllowlistEntries()
	if err != nil {
		return models.AllowlistEntry{}, err
	}
	for _, entry := range entries {
		if entry.Email == normalizedEmail {
			return entry, nil
		}
	}
	return models.AllowlistEntry{}, ErrNotFound
}

func (s *Store) DeleteAllowlistEntry(email string) error {
	normalizedEmail := normalizeEmail(email)
	result, err := s.db.Exec(`DELETE FROM signup_allowlist WHERE email = ? AND claimed_by IS NULL`, normalizedEmail)
	if err != nil {
		return fmt.Errorf("delete allowlist entry: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		var exists int
		if err := s.db.QueryRow(`SELECT 1 FROM signup_allowlist WHERE email = ?`, normalizedEmail).Scan(&exists); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return fmt.Errorf("check allowlist entry: %w", err)
		}
		return ErrConflict
	}
	return nil
}

func (s *Store) EnsureWorkbookAccess(userID, workbookID string) error {
	var exists int
	err := s.db.QueryRow(`
SELECT 1
FROM workbook_users
WHERE workbook_id = ? AND user_id = ?
`, workbookID, userID).Scan(&exists)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("check workbook access: %w", err)
	}
	return nil
}

func (s *Store) GetWorkbookByIDForUser(userID, workbookID string) (models.Workbook, map[string]models.Sheet, error) {
	if err := s.EnsureWorkbookAccess(userID, workbookID); err != nil {
		return models.Workbook{}, nil, err
	}
	return s.GetWorkbookByID(workbookID)
}

func (s *Store) GetWorkbookByHashForUser(userID, fileHash string) (models.Workbook, map[string]models.Sheet, bool, error) {
	var id string
	err := s.db.QueryRow(`
SELECT w.id
FROM workbooks w
JOIN workbook_users wu ON wu.workbook_id = w.id
WHERE wu.user_id = ? AND w.file_hash = ?
`, userID, fileHash).Scan(&id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.Workbook{}, nil, false, nil
		}
		return models.Workbook{}, nil, false, fmt.Errorf("find workbook by hash: %w", err)
	}
	workbook, sheets, err := s.GetWorkbookByID(id)
	if err != nil {
		return models.Workbook{}, nil, false, err
	}
	return workbook, sheets, true, nil
}

func (s *Store) ListFilesForUser(userID string, limit int) ([]models.FileEntry, error) {
	query := `
SELECT w.id, w.file_name, w.file_path, w.file_hash, w.created_at, w.updated_at, w.last_opened_at
FROM workbooks w
JOIN workbook_users wu ON wu.workbook_id = w.id
WHERE wu.user_id = ?
ORDER BY w.updated_at DESC
`
	args := []any{userID}
	if limit > 0 {
		query += ` LIMIT ?`
		args = append(args, limit)
	}
	return s.queryFileEntries(query, args...)
}

func (s *Store) ListRecentFilesForUser(userID string, limit int) ([]models.FileEntry, error) {
	query := `
SELECT w.id, w.file_name, w.file_path, w.file_hash, w.created_at, w.updated_at, w.last_opened_at
FROM workbooks w
JOIN workbook_users wu ON wu.workbook_id = w.id
WHERE wu.user_id = ?
ORDER BY w.last_opened_at DESC
`
	args := []any{userID}
	if limit > 0 {
		query += ` LIMIT ?`
		args = append(args, limit)
	}
	return s.queryFileEntries(query, args...)
}

func (s *Store) queryFileEntries(query string, args ...any) ([]models.FileEntry, error) {
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query files: %w", err)
	}
	defer func() { _ = rows.Close() }()

	entries := make([]models.FileEntry, 0)
	for rows.Next() {
		var entry models.FileEntry
		var createdAt, updatedAt, lastOpenedAt string
		if err := rows.Scan(&entry.ID, &entry.FileName, &entry.FilePath, &entry.FileHash, &createdAt, &updatedAt, &lastOpenedAt); err != nil {
			return nil, fmt.Errorf("scan file entry: %w", err)
		}
		entry.CreatedAt = parseTimeOrNow(createdAt)
		entry.UpdatedAt = parseTimeOrNow(updatedAt)
		entry.LastOpenedAt = parseTimeOrNow(lastOpenedAt)
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate files: %w", err)
	}
	return entries, nil
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func normalizeName(name, email string) string {
	trimmed := strings.TrimSpace(name)
	if trimmed != "" {
		return trimmed
	}
	parts := strings.Split(email, "@")
	if len(parts) > 0 && parts[0] != "" {
		return parts[0]
	}
	return email
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
