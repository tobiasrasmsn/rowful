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

func normalizeFolderName(name string) (string, error) {
	normalized := strings.TrimSpace(name)
	if normalized == "" {
		return "", ErrInvalid
	}
	if strings.Contains(normalized, "/") || strings.Contains(normalized, "\\") {
		return "", ErrInvalid
	}
	return normalized, nil
}

func normalizeFolderID(folderID string) string {
	return strings.TrimSpace(folderID)
}

func nullableFolderIDValue(folderID string) any {
	normalized := normalizeFolderID(folderID)
	if normalized == "" {
		return nil
	}
	return normalized
}

func (s *Store) EnsureFolderAccess(userID, folderID string) error {
	folderID = normalizeFolderID(folderID)
	if folderID == "" {
		return nil
	}

	var exists int
	err := s.db.QueryRow(`
SELECT 1
FROM workbook_folders
WHERE id = ? AND user_id = ?
`, folderID, userID).Scan(&exists)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("check folder access: %w", err)
	}
	return nil
}

func (s *Store) ListFoldersForUser(userID string) ([]models.FolderEntry, error) {
	rows, err := s.db.Query(`
SELECT id, name, COALESCE(parent_id, ''), created_at, updated_at
FROM workbook_folders
WHERE user_id = ?
ORDER BY COALESCE(parent_id, '') ASC, name COLLATE NOCASE ASC, created_at ASC
`, userID)
	if err != nil {
		return nil, fmt.Errorf("query folders: %w", err)
	}
	defer func() { _ = rows.Close() }()

	folders := make([]models.FolderEntry, 0)
	for rows.Next() {
		folder, err := scanFolderEntry(rows)
		if err != nil {
			return nil, err
		}
		folders = append(folders, folder)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate folders: %w", err)
	}
	return folders, nil
}

func (s *Store) CreateFolder(userID, name, parentID string) (models.FolderEntry, error) {
	normalizedName, err := normalizeFolderName(name)
	if err != nil {
		return models.FolderEntry{}, err
	}
	parentID = normalizeFolderID(parentID)

	tx, err := s.db.Begin()
	if err != nil {
		return models.FolderEntry{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if err := s.ensureFolderAccessTx(tx, userID, parentID); err != nil {
		return models.FolderEntry{}, err
	}
	if err := s.ensureSiblingFolderNameAvailableTx(tx, userID, parentID, normalizedName, ""); err != nil {
		return models.FolderEntry{}, err
	}

	now := time.Now().UTC()
	folder := models.FolderEntry{
		ID:        uuid.NewString(),
		Name:      normalizedName,
		ParentID:  parentID,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if _, err := tx.Exec(`
INSERT INTO workbook_folders(id, user_id, name, parent_id, created_at, updated_at)
VALUES(?, ?, ?, ?, ?, ?)
`, folder.ID, userID, folder.Name, nullableFolderIDValue(folder.ParentID), folder.CreatedAt.Format(time.RFC3339Nano), folder.UpdatedAt.Format(time.RFC3339Nano)); err != nil {
		return models.FolderEntry{}, fmt.Errorf("insert folder: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return models.FolderEntry{}, fmt.Errorf("commit tx: %w", err)
	}
	return folder, nil
}

func (s *Store) RenameFolder(userID, folderID, name string) (models.FolderEntry, error) {
	normalizedName, err := normalizeFolderName(name)
	if err != nil {
		return models.FolderEntry{}, err
	}
	folderID = normalizeFolderID(folderID)
	if folderID == "" {
		return models.FolderEntry{}, ErrInvalid
	}

	tx, err := s.db.Begin()
	if err != nil {
		return models.FolderEntry{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	folder, err := s.getFolderByIDTx(tx, userID, folderID)
	if err != nil {
		return models.FolderEntry{}, err
	}
	if err := s.ensureSiblingFolderNameAvailableTx(tx, userID, folder.ParentID, normalizedName, folder.ID); err != nil {
		return models.FolderEntry{}, err
	}

	folder.Name = normalizedName
	folder.UpdatedAt = time.Now().UTC()
	if _, err := tx.Exec(`
UPDATE workbook_folders
SET name = ?, updated_at = ?
WHERE id = ? AND user_id = ?
`, folder.Name, folder.UpdatedAt.Format(time.RFC3339Nano), folder.ID, userID); err != nil {
		return models.FolderEntry{}, fmt.Errorf("rename folder: %w", err)
	}

	if err := s.rebuildUserWorkbookPathsTx(tx, userID); err != nil {
		return models.FolderEntry{}, err
	}
	if err := tx.Commit(); err != nil {
		return models.FolderEntry{}, fmt.Errorf("commit tx: %w", err)
	}
	return folder, nil
}

func (s *Store) MoveFolder(userID, folderID, parentID string) (models.FolderEntry, error) {
	folderID = normalizeFolderID(folderID)
	parentID = normalizeFolderID(parentID)
	if folderID == "" || folderID == parentID {
		return models.FolderEntry{}, ErrInvalid
	}

	tx, err := s.db.Begin()
	if err != nil {
		return models.FolderEntry{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	folder, err := s.getFolderByIDTx(tx, userID, folderID)
	if err != nil {
		return models.FolderEntry{}, err
	}
	if err := s.ensureFolderAccessTx(tx, userID, parentID); err != nil {
		return models.FolderEntry{}, err
	}
	if parentID != "" {
		isDescendant, err := s.folderIsDescendantTx(tx, userID, parentID, folderID)
		if err != nil {
			return models.FolderEntry{}, err
		}
		if isDescendant {
			return models.FolderEntry{}, ErrInvalid
		}
	}
	if err := s.ensureSiblingFolderNameAvailableTx(tx, userID, parentID, folder.Name, folder.ID); err != nil {
		return models.FolderEntry{}, err
	}

	folder.ParentID = parentID
	folder.UpdatedAt = time.Now().UTC()
	if _, err := tx.Exec(`
UPDATE workbook_folders
SET parent_id = ?, updated_at = ?
WHERE id = ? AND user_id = ?
`, nullableFolderIDValue(folder.ParentID), folder.UpdatedAt.Format(time.RFC3339Nano), folder.ID, userID); err != nil {
		return models.FolderEntry{}, fmt.Errorf("move folder: %w", err)
	}

	if err := s.rebuildUserWorkbookPathsTx(tx, userID); err != nil {
		return models.FolderEntry{}, err
	}
	if err := tx.Commit(); err != nil {
		return models.FolderEntry{}, fmt.Errorf("commit tx: %w", err)
	}
	return folder, nil
}

func (s *Store) DeleteFolder(userID, folderID string) error {
	folderID = normalizeFolderID(folderID)
	if folderID == "" {
		return ErrInvalid
	}

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := s.getFolderByIDTx(tx, userID, folderID); err != nil {
		return err
	}

	if _, err := tx.Exec(`
WITH RECURSIVE folder_tree(id) AS (
  SELECT id
  FROM workbook_folders
  WHERE id = ? AND user_id = ?
  UNION ALL
  SELECT child.id
  FROM workbook_folders child
  JOIN folder_tree parent ON child.parent_id = parent.id
  WHERE child.user_id = ?
)
DELETE FROM workbooks
WHERE id IN (
  SELECT DISTINCT w.id
  FROM workbooks w
  JOIN workbook_users wu ON wu.workbook_id = w.id
  JOIN folder_tree ft ON ft.id = w.folder_id
  WHERE wu.user_id = ?
)
`, folderID, userID, userID, userID); err != nil {
		return fmt.Errorf("delete workbooks in folder tree: %w", err)
	}

	result, err := tx.Exec(`
DELETE FROM workbook_folders
WHERE id = ? AND user_id = ?
`, folderID, userID)
	if err != nil {
		return fmt.Errorf("delete folder: %w", err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("count deleted folders: %w", err)
	}
	if rowsAffected == 0 {
		return ErrNotFound
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

func (s *Store) MoveWorkbook(userID, workbookID, folderID string) error {
	if err := s.EnsureWorkbookAccess(userID, workbookID); err != nil {
		return err
	}
	folderID = normalizeFolderID(folderID)

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if err := s.ensureFolderAccessTx(tx, userID, folderID); err != nil {
		return err
	}
	folderPath, err := s.getFolderPathTx(tx, userID, folderID)
	if err != nil {
		return err
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := tx.Exec(`
UPDATE workbooks
SET folder_id = ?, file_path = ?, updated_at = ?
WHERE id = ?
`, folderID, folderPath, now, workbookID)
	if err != nil {
		return fmt.Errorf("move workbook: %w", err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("count moved workbooks: %w", err)
	}
	if rowsAffected == 0 {
		return ErrNotFound
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

func (s *Store) ensureFolderAccessTx(tx *sql.Tx, userID, folderID string) error {
	folderID = normalizeFolderID(folderID)
	if folderID == "" {
		return nil
	}

	var exists int
	err := tx.QueryRow(`
SELECT 1
FROM workbook_folders
WHERE id = ? AND user_id = ?
`, folderID, userID).Scan(&exists)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("check folder access: %w", err)
	}
	return nil
}

func (s *Store) ensureSiblingFolderNameAvailableTx(
	tx *sql.Tx,
	userID, parentID, name, excludeID string,
) error {
	var existingID string
	err := tx.QueryRow(`
SELECT id
FROM workbook_folders
WHERE user_id = ?
  AND COALESCE(parent_id, '') = ?
  AND lower(name) = lower(?)
  AND id <> ?
LIMIT 1
`, userID, parentID, name, excludeID).Scan(&existingID)
	if err == nil {
		return ErrConflict
	}
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	return fmt.Errorf("check sibling folder name: %w", err)
}

func (s *Store) getFolderByIDTx(tx *sql.Tx, userID, folderID string) (models.FolderEntry, error) {
	row := tx.QueryRow(`
SELECT id, name, COALESCE(parent_id, ''), created_at, updated_at
FROM workbook_folders
WHERE id = ? AND user_id = ?
`, folderID, userID)
	folder, err := scanFolderEntry(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.FolderEntry{}, ErrNotFound
		}
		return models.FolderEntry{}, err
	}
	return folder, nil
}

func (s *Store) folderIsDescendantTx(
	tx *sql.Tx,
	userID, folderID, possibleAncestorID string,
) (bool, error) {
	currentID := normalizeFolderID(folderID)
	ancestorID := normalizeFolderID(possibleAncestorID)
	seen := map[string]struct{}{}

	for currentID != "" {
		if currentID == ancestorID {
			return true, nil
		}
		if _, exists := seen[currentID]; exists {
			return false, ErrInvalid
		}
		seen[currentID] = struct{}{}

		var parentID sql.NullString
		err := tx.QueryRow(`
SELECT parent_id
FROM workbook_folders
WHERE id = ? AND user_id = ?
`, currentID, userID).Scan(&parentID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return false, ErrNotFound
			}
			return false, fmt.Errorf("load folder parent: %w", err)
		}
		if parentID.Valid {
			currentID = parentID.String
		} else {
			currentID = ""
		}
	}

	return false, nil
}

func (s *Store) getFolderPathTx(tx *sql.Tx, userID, folderID string) (string, error) {
	currentID := normalizeFolderID(folderID)
	if currentID == "" {
		return "", nil
	}

	segments := make([]string, 0, 4)
	seen := map[string]struct{}{}
	for currentID != "" {
		if _, exists := seen[currentID]; exists {
			return "", ErrInvalid
		}
		seen[currentID] = struct{}{}

		folder, err := s.getFolderByIDTx(tx, userID, currentID)
		if err != nil {
			return "", err
		}
		segments = append([]string{folder.Name}, segments...)
		currentID = folder.ParentID
	}

	return strings.Join(segments, "/"), nil
}

func (s *Store) rebuildUserWorkbookPathsTx(tx *sql.Tx, userID string) error {
	rows, err := tx.Query(`
SELECT w.id, w.folder_id
FROM workbooks w
JOIN workbook_users wu ON wu.workbook_id = w.id
WHERE wu.user_id = ?
`, userID)
	if err != nil {
		return fmt.Errorf("query user workbooks for path rebuild: %w", err)
	}
	defer func() { _ = rows.Close() }()

	type workbookPath struct {
		id       string
		folderID string
	}
	workbooks := make([]workbookPath, 0)
	for rows.Next() {
		var workbook workbookPath
		if err := rows.Scan(&workbook.id, &workbook.folderID); err != nil {
			return fmt.Errorf("scan user workbook for path rebuild: %w", err)
		}
		workbooks = append(workbooks, workbook)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate user workbooks for path rebuild: %w", err)
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	stmt, err := tx.Prepare(`
UPDATE workbooks
SET file_path = ?, updated_at = ?
WHERE id = ?
`)
	if err != nil {
		return fmt.Errorf("prepare workbook path rebuild: %w", err)
	}
	defer func() { _ = stmt.Close() }()

	for _, workbook := range workbooks {
		path, err := s.getFolderPathTx(tx, userID, workbook.folderID)
		if err != nil {
			return err
		}
		if _, err := stmt.Exec(path, now, workbook.id); err != nil {
			return fmt.Errorf("update workbook path: %w", err)
		}
	}

	return nil
}

func scanFolderEntry(scanner interface{ Scan(dest ...any) error }) (models.FolderEntry, error) {
	var folder models.FolderEntry
	var parentID sql.NullString
	var createdAt string
	var updatedAt string
	if err := scanner.Scan(&folder.ID, &folder.Name, &parentID, &createdAt, &updatedAt); err != nil {
		return models.FolderEntry{}, err
	}
	if parentID.Valid {
		folder.ParentID = parentID.String
	}
	folder.CreatedAt = parseTimeOrNow(createdAt)
	folder.UpdatedAt = parseTimeOrNow(updatedAt)
	return folder, nil
}
