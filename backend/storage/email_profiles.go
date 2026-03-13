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

func (s *Store) ListEmailProfiles(userID string) ([]models.EmailProfile, error) {
	rows, err := s.db.Query(`
SELECT id, nickname, smtp_encrypted, smtp_host, smtp_port, smtp_username, smtp_password, smtp_from_email, smtp_from_name, smtp_use_tls, created_at, updated_at
FROM email_profiles
WHERE user_id = ?
ORDER BY nickname COLLATE NOCASE ASC, created_at ASC
`, userID)
	if err != nil {
		return nil, fmt.Errorf("query email profiles: %w", err)
	}
	defer func() { _ = rows.Close() }()

	profiles := make([]models.EmailProfile, 0)
	for rows.Next() {
		profile, err := s.scanEmailProfile(rows)
		if err != nil {
			return nil, err
		}
		profiles = append(profiles, profile)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate email profiles: %w", err)
	}
	return profiles, nil
}

func (s *Store) GetEmailProfile(userID, profileID string) (models.EmailProfile, error) {
	profileID = strings.TrimSpace(profileID)
	if profileID == "" {
		return models.EmailProfile{}, ErrInvalid
	}

	row := s.db.QueryRow(`
SELECT id, nickname, smtp_encrypted, smtp_host, smtp_port, smtp_username, smtp_password, smtp_from_email, smtp_from_name, smtp_use_tls, created_at, updated_at
FROM email_profiles
WHERE user_id = ? AND id = ?
`, userID, profileID)
	profile, err := s.scanEmailProfile(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.EmailProfile{}, ErrNotFound
		}
		return models.EmailProfile{}, err
	}
	return profile, nil
}

func (s *Store) CreateEmailProfile(userID string, input models.EmailProfileInput) (models.EmailProfile, error) {
	normalized, err := normalizeEmailProfileInput(input)
	if err != nil {
		return models.EmailProfile{}, err
	}

	now := time.Now().UTC()
	profile := models.EmailProfile{
		ID:        uuid.NewString(),
		Nickname:  normalized.Nickname,
		SMTP:      normalized.SMTP,
		CreatedAt: now,
		UpdatedAt: now,
	}

	encryptedSMTP, err := s.encryptSMTPSettings(profile.SMTP)
	if err != nil {
		return models.EmailProfile{}, fmt.Errorf("encrypt email profile smtp settings: %w", err)
	}
	if _, err := s.db.Exec(`
INSERT INTO email_profiles(
  id, user_id, nickname, smtp_encrypted, smtp_host, smtp_port, smtp_username, smtp_password, smtp_from_email, smtp_from_name, smtp_use_tls, created_at, updated_at
)
VALUES(?, ?, ?, ?, '', ?, '', '', '', '', 1, ?, ?)
`, profile.ID, userID, profile.Nickname, encryptedSMTP, defaultSMTPPort, profile.CreatedAt.Format(time.RFC3339Nano), profile.UpdatedAt.Format(time.RFC3339Nano)); err != nil {
		return models.EmailProfile{}, fmt.Errorf("insert email profile: %w", err)
	}

	return profile, nil
}

func (s *Store) UpdateEmailProfile(userID, profileID string, input models.EmailProfileInput) (models.EmailProfile, error) {
	normalized, err := normalizeEmailProfileInput(input)
	if err != nil {
		return models.EmailProfile{}, err
	}
	profileID = strings.TrimSpace(profileID)
	if profileID == "" {
		return models.EmailProfile{}, ErrInvalid
	}

	createdAt, err := s.getEmailProfileCreatedAt(userID, profileID)
	if err != nil {
		return models.EmailProfile{}, err
	}

	updatedAt := time.Now().UTC()
	encryptedSMTP, err := s.encryptSMTPSettings(normalized.SMTP)
	if err != nil {
		return models.EmailProfile{}, fmt.Errorf("encrypt email profile smtp settings: %w", err)
	}
	if _, err := s.db.Exec(`
UPDATE email_profiles
SET nickname = ?, smtp_encrypted = ?, smtp_host = '', smtp_port = ?, smtp_username = '', smtp_password = '', smtp_from_email = '', smtp_from_name = '', smtp_use_tls = 1, updated_at = ?
WHERE user_id = ? AND id = ?
`, normalized.Nickname, encryptedSMTP, defaultSMTPPort, updatedAt.Format(time.RFC3339Nano), userID, profileID); err != nil {
		return models.EmailProfile{}, fmt.Errorf("update email profile: %w", err)
	}

	return models.EmailProfile{
		ID:        profileID,
		Nickname:  normalized.Nickname,
		SMTP:      normalized.SMTP,
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}, nil
}

func (s *Store) DeleteEmailProfile(userID, profileID string) error {
	profileID = strings.TrimSpace(profileID)
	if profileID == "" {
		return ErrInvalid
	}

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	result, err := tx.Exec(`DELETE FROM email_profiles WHERE user_id = ? AND id = ?`, userID, profileID)
	if err != nil {
		return fmt.Errorf("delete email profile: %w", err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("count deleted email profiles: %w", err)
	}
	if rowsAffected == 0 {
		return ErrNotFound
	}

	if _, err := tx.Exec(`
UPDATE file_settings
SET email_profile_id = ''
WHERE email_profile_id = ?
  AND workbook_id IN (
    SELECT workbook_id
    FROM workbook_users
    WHERE user_id = ?
  )
`, profileID, userID); err != nil {
		return fmt.Errorf("detach email profile from files: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

func (s *Store) ResolveWorkbookSMTPSettings(userID, workbookID string) (models.SMTPSettings, error) {
	exists, err := s.workbookExists(workbookID)
	if err != nil {
		return models.SMTPSettings{}, err
	}
	if !exists {
		return models.SMTPSettings{}, ErrNotFound
	}

	legacy := models.SMTPSettings{
		Port:   defaultSMTPPort,
		UseTLS: true,
	}
	var encryptedSMTP string
	var profileID string
	var smtpUseTLS int
	err = s.db.QueryRow(`
SELECT email_profile_id, smtp_encrypted, smtp_host, smtp_port, smtp_username, smtp_password, smtp_from_email, smtp_from_name, smtp_use_tls
FROM file_settings
WHERE workbook_id = ?
`, workbookID).Scan(
		&profileID,
		&encryptedSMTP,
		&legacy.Host,
		&legacy.Port,
		&legacy.Username,
		&legacy.Password,
		&legacy.FromEmail,
		&legacy.FromName,
		&smtpUseTLS,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return normalizeSMTP(legacy), nil
		}
		return models.SMTPSettings{}, fmt.Errorf("load workbook smtp settings: %w", err)
	}
	legacy, err = decodeStoredSMTPSettings(s, encryptedSMTP, legacy, smtpUseTLS)
	if err != nil {
		return models.SMTPSettings{}, err
	}

	profileID = strings.TrimSpace(profileID)
	if profileID == "" {
		return legacy, nil
	}

	profile, err := s.GetEmailProfile(userID, profileID)
	if err == nil {
		return profile.SMTP, nil
	}
	if errors.Is(err, ErrNotFound) {
		return legacy, nil
	}
	return models.SMTPSettings{}, err
}

func normalizeEmailProfileInput(input models.EmailProfileInput) (models.EmailProfileInput, error) {
	normalized := models.EmailProfileInput{
		Nickname: strings.TrimSpace(input.Nickname),
		SMTP:     normalizeSMTP(input.SMTP),
	}
	if normalized.Nickname == "" {
		return models.EmailProfileInput{}, ErrInvalid
	}
	return normalized, nil
}

func (s *Store) getEmailProfileCreatedAt(userID, profileID string) (time.Time, error) {
	var createdAt string
	err := s.db.QueryRow(`
SELECT created_at
FROM email_profiles
WHERE user_id = ? AND id = ?
`, userID, profileID).Scan(&createdAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return time.Time{}, ErrNotFound
		}
		return time.Time{}, fmt.Errorf("load email profile: %w", err)
	}
	return parseTimeOrNow(createdAt), nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func (s *Store) scanEmailProfile(scanner rowScanner) (models.EmailProfile, error) {
	var profile models.EmailProfile
	var encryptedSMTP string
	var smtpUseTLS int
	var createdAt string
	var updatedAt string
	err := scanner.Scan(
		&profile.ID,
		&profile.Nickname,
		&encryptedSMTP,
		&profile.SMTP.Host,
		&profile.SMTP.Port,
		&profile.SMTP.Username,
		&profile.SMTP.Password,
		&profile.SMTP.FromEmail,
		&profile.SMTP.FromName,
		&smtpUseTLS,
		&createdAt,
		&updatedAt,
	)
	if err != nil {
		return models.EmailProfile{}, err
	}
	profile.SMTP, err = decodeStoredSMTPSettings(s, encryptedSMTP, profile.SMTP, smtpUseTLS)
	if err != nil {
		return models.EmailProfile{}, err
	}
	profile.CreatedAt = parseTimeOrNow(createdAt)
	profile.UpdatedAt = parseTimeOrNow(updatedAt)
	return profile, nil
}
