package storage

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"rowful/models"
)

const smtpEncryptionPrefix = "enc:v1:"

type secretCodec struct {
	aead cipher.AEAD
}

func newSecretCodec(secret string) (*secretCodec, error) {
	trimmed := strings.TrimSpace(secret)
	if len(trimmed) < 32 {
		return nil, fmt.Errorf("APP_ENCRYPTION_KEY must be set to at least 32 characters")
	}

	key := sha256.Sum256([]byte("rowful:smtp:" + trimmed))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, fmt.Errorf("create cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create AEAD: %w", err)
	}
	return &secretCodec{aead: aead}, nil
}

func (c *secretCodec) encryptString(plaintext string) (string, error) {
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("read nonce: %w", err)
	}
	ciphertext := c.aead.Seal(nil, nonce, []byte(plaintext), nil)
	payload := append(nonce, ciphertext...)
	return smtpEncryptionPrefix + base64.StdEncoding.EncodeToString(payload), nil
}

func (c *secretCodec) decryptString(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", nil
	}
	if !strings.HasPrefix(trimmed, smtpEncryptionPrefix) {
		return "", ErrInvalid
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(trimmed, smtpEncryptionPrefix))
	if err != nil {
		return "", fmt.Errorf("decode ciphertext: %w", err)
	}
	if len(raw) < c.aead.NonceSize() {
		return "", ErrInvalid
	}
	nonce := raw[:c.aead.NonceSize()]
	ciphertext := raw[c.aead.NonceSize():]
	plaintext, err := c.aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt ciphertext: %w", err)
	}
	return string(plaintext), nil
}

func (s *Store) encryptSMTPSettings(settings models.SMTPSettings) (string, error) {
	payload, err := json.Marshal(normalizeSMTP(settings))
	if err != nil {
		return "", fmt.Errorf("marshal smtp settings: %w", err)
	}
	return s.secrets.encryptString(string(payload))
}

func (s *Store) decryptSMTPSettings(encrypted string) (models.SMTPSettings, error) {
	plaintext, err := s.secrets.decryptString(encrypted)
	if err != nil {
		return models.SMTPSettings{}, err
	}
	if strings.TrimSpace(plaintext) == "" {
		return models.SMTPSettings{}, nil
	}
	var settings models.SMTPSettings
	if err := json.Unmarshal([]byte(plaintext), &settings); err != nil {
		return models.SMTPSettings{}, fmt.Errorf("unmarshal smtp settings: %w", err)
	}
	return normalizeSMTP(settings), nil
}

func decodeStoredSMTPSettings(
	store *Store,
	encrypted string,
	legacy models.SMTPSettings,
	legacyUseTLS int,
) (models.SMTPSettings, error) {
	if strings.TrimSpace(encrypted) != "" {
		return store.decryptSMTPSettings(encrypted)
	}
	legacy = normalizeSMTP(legacy)
	legacy.UseTLS = legacyUseTLS == 1
	return legacy, nil
}

func hasLegacySMTPData(settings models.SMTPSettings) bool {
	return strings.TrimSpace(settings.Host) != "" ||
		strings.TrimSpace(settings.Username) != "" ||
		strings.TrimSpace(settings.Password) != "" ||
		strings.TrimSpace(settings.FromEmail) != "" ||
		strings.TrimSpace(settings.FromName) != ""
}

func (s *Store) migrateLegacySMTPSecrets() error {
	if err := s.migrateLegacyFileSMTPSecrets(); err != nil {
		return err
	}
	if err := s.migrateLegacyEmailProfileSMTPSecrets(); err != nil {
		return err
	}
	return nil
}

func (s *Store) migrateLegacyFileSMTPSecrets() error {
	rows, err := s.db.Query(`
SELECT workbook_id, smtp_host, smtp_port, smtp_username, smtp_password, smtp_from_email, smtp_from_name, smtp_use_tls
FROM file_settings
WHERE smtp_encrypted = ''
`)
	if err != nil {
		return fmt.Errorf("query legacy file smtp settings: %w", err)
	}
	defer func() { _ = rows.Close() }()

	type pendingFileMigration struct {
		workbookID string
		settings   models.SMTPSettings
	}

	pending := make([]pendingFileMigration, 0)
	for rows.Next() {
		var item pendingFileMigration
		var useTLS int
		if err := rows.Scan(
			&item.workbookID,
			&item.settings.Host,
			&item.settings.Port,
			&item.settings.Username,
			&item.settings.Password,
			&item.settings.FromEmail,
			&item.settings.FromName,
			&useTLS,
		); err != nil {
			return fmt.Errorf("scan legacy file smtp settings: %w", err)
		}
		item.settings.UseTLS = useTLS == 1
		if !hasLegacySMTPData(item.settings) {
			continue
		}
		pending = append(pending, item)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate legacy file smtp settings: %w", err)
	}

	for _, item := range pending {
		encrypted, err := s.encryptSMTPSettings(item.settings)
		if err != nil {
			return fmt.Errorf("encrypt file smtp settings: %w", err)
		}
		if _, err := s.db.Exec(`
UPDATE file_settings
SET smtp_encrypted = ?, smtp_host = '', smtp_port = ?, smtp_username = '', smtp_password = '', smtp_from_email = '', smtp_from_name = '', smtp_use_tls = 1
WHERE workbook_id = ?
`, encrypted, defaultSMTPPort, item.workbookID); err != nil {
			return fmt.Errorf("store encrypted file smtp settings: %w", err)
		}
	}
	return nil
}

func (s *Store) migrateLegacyEmailProfileSMTPSecrets() error {
	rows, err := s.db.Query(`
SELECT id, smtp_host, smtp_port, smtp_username, smtp_password, smtp_from_email, smtp_from_name, smtp_use_tls
FROM email_profiles
WHERE smtp_encrypted = ''
`)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("query legacy email profile smtp settings: %w", err)
	}
	defer func() { _ = rows.Close() }()

	type pendingProfileMigration struct {
		id       string
		settings models.SMTPSettings
	}

	pending := make([]pendingProfileMigration, 0)
	for rows.Next() {
		var item pendingProfileMigration
		var useTLS int
		if err := rows.Scan(
			&item.id,
			&item.settings.Host,
			&item.settings.Port,
			&item.settings.Username,
			&item.settings.Password,
			&item.settings.FromEmail,
			&item.settings.FromName,
			&useTLS,
		); err != nil {
			return fmt.Errorf("scan legacy email profile smtp settings: %w", err)
		}
		item.settings.UseTLS = useTLS == 1
		if !hasLegacySMTPData(item.settings) {
			continue
		}
		pending = append(pending, item)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate legacy email profile smtp settings: %w", err)
	}

	for _, item := range pending {
		encrypted, err := s.encryptSMTPSettings(item.settings)
		if err != nil {
			return fmt.Errorf("encrypt email profile smtp settings: %w", err)
		}
		if _, err := s.db.Exec(`
UPDATE email_profiles
SET smtp_encrypted = ?, smtp_host = '', smtp_port = ?, smtp_username = '', smtp_password = '', smtp_from_email = '', smtp_from_name = '', smtp_use_tls = 1
WHERE id = ?
`, encrypted, defaultSMTPPort, item.id); err != nil {
			return fmt.Errorf("store encrypted email profile smtp settings: %w", err)
		}
	}
	return nil
}
