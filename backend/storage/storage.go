package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"planar/models"
)

const maxCreateRangeArea = 4096
const defaultFileCurrency = "USD"
const defaultSMTPPort = 587

type Store struct {
	db *sql.DB
}

type storedCell struct {
	row      int
	col      int
	cellType string
	value    string
	display  string
	formula  string
	style    *models.CellStyle
}

func New(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	if _, err := db.Exec("PRAGMA foreign_keys = ON;"); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("enable foreign keys: %w", err)
	}
	if _, err := db.Exec("PRAGMA journal_mode = WAL;"); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("set WAL mode: %w", err)
	}
	if _, err := db.Exec("PRAGMA busy_timeout = 5000;"); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("set busy timeout: %w", err)
	}

	store := &Store{db: db}
	if err := store.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) migrate() error {
	const schema = `
CREATE TABLE IF NOT EXISTS workbooks (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL UNIQUE,
  file_path TEXT NOT NULL DEFAULT '',
  active_sheet TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT '',
  last_opened_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sheets (
  workbook_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sheet_index INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  max_row INTEGER NOT NULL DEFAULT 0,
  max_col INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workbook_id, name),
  FOREIGN KEY (workbook_id) REFERENCES workbooks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sheet_cells (
  workbook_id TEXT NOT NULL,
  sheet_name TEXT NOT NULL,
  row_idx INTEGER NOT NULL,
  col_idx INTEGER NOT NULL,
  cell_type TEXT NOT NULL DEFAULT '',
  value TEXT NOT NULL DEFAULT '',
  display TEXT NOT NULL DEFAULT '',
  formula TEXT NOT NULL DEFAULT '',
  style_json TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (workbook_id, sheet_name, row_idx, col_idx),
  FOREIGN KEY (workbook_id, sheet_name) REFERENCES sheets(workbook_id, name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS file_settings (
  workbook_id TEXT PRIMARY KEY,
  currency TEXT NOT NULL DEFAULT 'USD',
  smtp_host TEXT NOT NULL DEFAULT '',
  smtp_port INTEGER NOT NULL DEFAULT 587,
  smtp_username TEXT NOT NULL DEFAULT '',
  smtp_password TEXT NOT NULL DEFAULT '',
  smtp_from_email TEXT NOT NULL DEFAULT '',
  smtp_from_name TEXT NOT NULL DEFAULT '',
  smtp_use_tls INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (workbook_id) REFERENCES workbooks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS managed_domains (
  domain TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
`

	if _, err := s.db.Exec(schema); err != nil {
		return fmt.Errorf("create schema: %w", err)
	}
	if err := s.migrateAuthTables(); err != nil {
		return err
	}

	if err := s.ensureWorkbookColumn("file_path", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := s.ensureWorkbookColumn("updated_at", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := s.ensureWorkbookColumn("last_opened_at", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := s.ensureSheetColumn("max_row", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := s.ensureSheetColumn("max_col", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}

	if _, err := s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_workbooks_file_hash ON workbooks(file_hash);`); err != nil {
		return fmt.Errorf("create index on workbooks.file_hash: %w", err)
	}
	if _, err := s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_workbooks_last_opened_at ON workbooks(last_opened_at);`); err != nil {
		return fmt.Errorf("create index on workbooks.last_opened_at: %w", err)
	}
	if _, err := s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_sheets_workbook_index ON sheets(workbook_id, sheet_index);`); err != nil {
		return fmt.Errorf("create index on sheets(workbook_id, sheet_index): %w", err)
	}
	if _, err := s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_sheet_cells_window ON sheet_cells(workbook_id, sheet_name, row_idx, col_idx);`); err != nil {
		return fmt.Errorf("create index on sheet_cells window: %w", err)
	}
	if _, err := s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_sheet_cells_col ON sheet_cells(workbook_id, sheet_name, col_idx, row_idx);`); err != nil {
		return fmt.Errorf("create index on sheet_cells col: %w", err)
	}
	if _, err := s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_file_settings_workbook_id ON file_settings(workbook_id);`); err != nil {
		return fmt.Errorf("create index on file_settings.workbook_id: %w", err)
	}
	if _, err := s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_managed_domains_created_at ON managed_domains(created_at);`); err != nil {
		return fmt.Errorf("create index on managed_domains.created_at: %w", err)
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := s.db.Exec(`
UPDATE workbooks
SET updated_at = CASE WHEN updated_at = '' THEN created_at ELSE updated_at END,
    last_opened_at = CASE WHEN last_opened_at = '' THEN created_at ELSE last_opened_at END
`); err != nil {
		return fmt.Errorf("backfill workbook timestamps: %w", err)
	}
	if _, err := s.db.Exec(`
UPDATE workbooks
SET updated_at = ?, last_opened_at = ?
WHERE updated_at = '' OR last_opened_at = ''
`, now, now); err != nil {
		return fmt.Errorf("finalize workbook timestamps: %w", err)
	}

	return nil
}

func (s *Store) ensureWorkbookColumn(name, ddl string) error {
	return ensureTableColumn(s.db, "workbooks", name, ddl)
}

func (s *Store) ensureSheetColumn(name, ddl string) error {
	return ensureTableColumn(s.db, "sheets", name, ddl)
}

func ensureTableColumn(db *sql.DB, tableName, name, ddl string) error {
	rows, err := db.Query(fmt.Sprintf(`PRAGMA table_info(%s)`, tableName))
	if err != nil {
		return fmt.Errorf("inspect %s schema: %w", tableName, err)
	}
	defer func() { _ = rows.Close() }()

	for rows.Next() {
		var cid int
		var colName, colType string
		var notNull int
		var dflt sql.NullString
		var pk int
		if err := rows.Scan(&cid, &colName, &colType, &notNull, &dflt, &pk); err != nil {
			return fmt.Errorf("scan %s schema row: %w", tableName, err)
		}
		if strings.EqualFold(colName, name) {
			return nil
		}
	}

	if _, err := db.Exec(fmt.Sprintf(`ALTER TABLE %s ADD COLUMN %s %s`, tableName, name, ddl)); err != nil {
		return fmt.Errorf("add %s.%s: %w", tableName, name, err)
	}
	return nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) SaveWorkbook(userID string, workbook models.Workbook, sheets map[string]models.Sheet, filePath string) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	created := workbook.CreatedAt.UTC().Format(time.RFC3339Nano)
	if workbook.CreatedAt.IsZero() {
		created = now
	}

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	_, err = tx.Exec(`
INSERT INTO workbooks(id, file_name, file_hash, file_path, active_sheet, created_at, updated_at, last_opened_at)
VALUES(?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  file_name=excluded.file_name,
  file_hash=excluded.file_hash,
  file_path=excluded.file_path,
  active_sheet=excluded.active_sheet,
  updated_at=excluded.updated_at,
  last_opened_at=excluded.last_opened_at
`, workbook.ID, workbook.FileName, workbook.FileHash, filePath, workbook.ActiveSheet, created, now, now)
	if err != nil {
		return fmt.Errorf("upsert workbook: %w", err)
	}
	if _, err := tx.Exec(`
INSERT INTO workbook_users(workbook_id, user_id, created_at)
VALUES(?, ?, ?)
ON CONFLICT(workbook_id) DO UPDATE SET user_id = excluded.user_id
`, workbook.ID, userID, now); err != nil {
		return fmt.Errorf("upsert workbook owner: %w", err)
	}

	if _, err := tx.Exec(`DELETE FROM sheets WHERE workbook_id = ?`, workbook.ID); err != nil {
		return fmt.Errorf("clear existing sheets: %w", err)
	}

	names := make([]string, 0, len(sheets))
	for name := range sheets {
		names = append(names, name)
	}
	sort.Slice(names, func(i, j int) bool {
		return sheets[names[i]].Index < sheets[names[j]].Index
	})

	insertSheetStmt, err := tx.Prepare(`
INSERT INTO sheets(workbook_id, name, sheet_index, data_json, max_row, max_col)
VALUES(?, ?, ?, ?, ?, ?)
`)
	if err != nil {
		return fmt.Errorf("prepare insert sheet: %w", err)
	}
	defer func() { _ = insertSheetStmt.Close() }()

	insertCellStmt, err := tx.Prepare(`
INSERT INTO sheet_cells(workbook_id, sheet_name, row_idx, col_idx, cell_type, value, display, formula, style_json)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
	if err != nil {
		return fmt.Errorf("prepare insert cell: %w", err)
	}
	defer func() { _ = insertCellStmt.Close() }()

	for _, name := range names {
		sheet := sheets[name]
		if _, err := insertSheetStmt.Exec(
			workbook.ID,
			sheet.Name,
			sheet.Index,
			string(buildSheetMetaJSON(sheet)),
			sheet.MaxRow,
			sheet.MaxCol,
		); err != nil {
			return fmt.Errorf("insert sheet %q: %w", name, err)
		}

		for _, row := range sheet.Rows {
			for _, cell := range row.Cells {
				styleJSON, err := encodeStyle(cell.Style)
				if err != nil {
					return fmt.Errorf("encode style for %s!%s: %w", sheet.Name, cell.Address, err)
				}
				if _, err := insertCellStmt.Exec(
					workbook.ID,
					sheet.Name,
					cell.Row,
					cell.Col,
					cell.Type,
					cell.Value,
					cell.Display,
					cell.Formula,
					styleJSON,
				); err != nil {
					return fmt.Errorf("insert cell %s!%s: %w", sheet.Name, cell.Address, err)
				}
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

func (s *Store) GetWorkbookByHash(fileHash string) (models.Workbook, map[string]models.Sheet, bool, error) {
	var id string
	err := s.db.QueryRow(`SELECT id FROM workbooks WHERE file_hash = ?`, fileHash).Scan(&id)
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

func (s *Store) GetWorkbookByID(id string) (models.Workbook, map[string]models.Sheet, error) {
	var workbook models.Workbook
	var createdAt string
	err := s.db.QueryRow(`
SELECT id, file_name, file_hash, active_sheet, created_at
FROM workbooks
WHERE id = ?
`, id).Scan(&workbook.ID, &workbook.FileName, &workbook.FileHash, &workbook.ActiveSheet, &createdAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.Workbook{}, nil, ErrNotFound
		}
		return models.Workbook{}, nil, fmt.Errorf("load workbook: %w", err)
	}

	parsedTime, err := time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		parsedTime = time.Now().UTC()
	}
	workbook.CreatedAt = parsedTime

	rows, err := s.db.Query(`
SELECT name, sheet_index, max_row, max_col, data_json
FROM sheets
WHERE workbook_id = ?
ORDER BY sheet_index ASC
`, id)
	if err != nil {
		return models.Workbook{}, nil, fmt.Errorf("query sheets: %w", err)
	}
	defer func() { _ = rows.Close() }()

	sheets := make(map[string]models.Sheet)
	metas := make([]models.SheetMeta, 0)
	for rows.Next() {
		var name, data string
		var index, maxRow, maxCol int
		if err := rows.Scan(&name, &index, &maxRow, &maxCol, &data); err != nil {
			return models.Workbook{}, nil, fmt.Errorf("scan sheet row: %w", err)
		}
		if maxRow == 0 && maxCol == 0 && data != "" {
			legacy, legacyErr := decodeLegacySheet(data)
			if legacyErr == nil {
				maxRow = legacy.MaxRow
				maxCol = legacy.MaxCol
			}
		}
		if maxRow == 0 && maxCol == 0 {
			cellMaxRow, cellMaxCol, boundsErr := s.getStoredSheetBounds(id, name)
			if boundsErr != nil {
				return models.Workbook{}, nil, boundsErr
			}
			maxRow = cellMaxRow
			maxCol = cellMaxCol
		}
		sheet := models.Sheet{Name: name, Index: index, MaxRow: maxRow, MaxCol: maxCol, Rows: []models.Row{}}
		sheets[name] = sheet
		metas = append(metas, models.SheetMeta{Name: name, Index: index, MaxRow: maxRow, MaxCol: maxCol})
	}
	if err := rows.Err(); err != nil {
		return models.Workbook{}, nil, fmt.Errorf("iterate sheets: %w", err)
	}

	workbook.Sheets = metas
	if workbook.ActiveSheet == "" && len(metas) > 0 {
		workbook.ActiveSheet = metas[0].Name
	}

	return workbook, sheets, nil
}

func (s *Store) GetSheet(workbookID, name string) (models.Sheet, error) {
	if err := s.ensureSheetIndexed(workbookID, name); err != nil {
		return models.Sheet{}, err
	}
	meta, _, err := s.getSheetMeta(workbookID, name)
	if err != nil {
		return models.Sheet{}, err
	}
	return s.GetSheetWindow(workbookID, name, 1, max(1, meta.MaxRow), 1, max(1, meta.MaxCol))
}

func (s *Store) GetSheetWindow(workbookID, name string, rowStart, rowCount, colStart, colCount int) (models.Sheet, error) {
	if err := s.ensureSheetIndexed(workbookID, name); err != nil {
		return models.Sheet{}, err
	}
	meta, _, err := s.getSheetMeta(workbookID, name)
	if err != nil {
		return models.Sheet{}, err
	}

	if rowStart < 1 {
		rowStart = 1
	}
	if colStart < 1 {
		colStart = 1
	}
	if rowCount < 1 {
		rowCount = 200
	}
	if colCount < 1 {
		colCount = max(50, min(meta.MaxCol, 200))
	}
	rowEnd := min(meta.MaxRow, rowStart+rowCount-1)
	colEnd := min(meta.MaxCol, colStart+colCount-1)
	if meta.MaxRow == 0 {
		rowEnd = rowStart - 1
	}
	if meta.MaxCol == 0 {
		colEnd = colStart - 1
	}

	result := models.Sheet{
		Name:   meta.Name,
		Index:  meta.Index,
		MaxRow: meta.MaxRow,
		MaxCol: meta.MaxCol,
		Rows:   []models.Row{},
	}
	if rowEnd < rowStart || colEnd < colStart {
		return result, nil
	}

	rows, err := s.db.Query(`
SELECT row_idx, col_idx, cell_type, value, display, formula, style_json
FROM sheet_cells
WHERE workbook_id = ? AND sheet_name = ? AND row_idx BETWEEN ? AND ? AND col_idx BETWEEN ? AND ?
ORDER BY row_idx ASC, col_idx ASC
`, workbookID, name, rowStart, rowEnd, colStart, colEnd)
	if err != nil {
		return models.Sheet{}, fmt.Errorf("query sheet window: %w", err)
	}
	defer func() { _ = rows.Close() }()

	rowMap := map[int][]models.Cell{}
	for rows.Next() {
		var rec storedCell
		var styleJSON string
		if err := rows.Scan(&rec.row, &rec.col, &rec.cellType, &rec.value, &rec.display, &rec.formula, &styleJSON); err != nil {
			return models.Sheet{}, fmt.Errorf("scan sheet window: %w", err)
		}
		style, err := decodeStyle(styleJSON)
		if err != nil {
			return models.Sheet{}, fmt.Errorf("decode style: %w", err)
		}
		rowMap[rec.row] = append(rowMap[rec.row], models.Cell{
			Address: toAddress(rec.row, rec.col),
			Row:     rec.row,
			Col:     rec.col,
			Type:    rec.cellType,
			Value:   rec.value,
			Display: rec.display,
			Formula: rec.formula,
			Style:   style,
		})
	}
	if err := rows.Err(); err != nil {
		return models.Sheet{}, fmt.Errorf("iterate sheet window: %w", err)
	}

	keys := make([]int, 0, len(rowMap))
	for rowIndex := range rowMap {
		keys = append(keys, rowIndex)
	}
	sort.Ints(keys)
	result.Rows = make([]models.Row, 0, len(keys))
	for _, rowIndex := range keys {
		result.Rows = append(result.Rows, models.Row{Index: rowIndex, Cells: rowMap[rowIndex]})
	}
	return result, nil
}

func (s *Store) UpdateSheet(workbookID string, sheet models.Sheet) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.Exec(`DELETE FROM sheet_cells WHERE workbook_id = ? AND sheet_name = ?`, workbookID, sheet.Name); err != nil {
		return fmt.Errorf("clear sheet cells: %w", err)
	}
	result, err := tx.Exec(`
UPDATE sheets
SET sheet_index = ?, data_json = ?, max_row = ?, max_col = ?
WHERE workbook_id = ? AND name = ?
`, sheet.Index, string(buildSheetMetaJSON(sheet)), sheet.MaxRow, sheet.MaxCol, workbookID, sheet.Name)
	if err != nil {
		return fmt.Errorf("update sheet meta: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return ErrNotFound
	}

	if err := s.insertCellsTx(tx, workbookID, sheet.Name, sheet.Rows); err != nil {
		return err
	}
	if err := s.touchWorkbookTx(tx, workbookID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

func (s *Store) CreateSheet(workbookID, name string) error {
	workbook, sheets, err := s.GetWorkbookByID(workbookID)
	if err != nil {
		return err
	}
	if _, exists := sheets[name]; exists {
		return ErrConflict
	}

	maxIndex := -1
	for _, meta := range workbook.Sheets {
		if meta.Index > maxIndex {
			maxIndex = meta.Index
		}
	}

	sheet := models.Sheet{Name: name, Index: maxIndex + 1, MaxRow: 200, MaxCol: 26, Rows: []models.Row{}}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := s.db.Exec(`
INSERT INTO sheets(workbook_id, name, sheet_index, data_json, max_row, max_col)
VALUES(?, ?, ?, ?, ?, ?)
`, workbookID, name, sheet.Index, string(buildSheetMetaJSON(sheet)), sheet.MaxRow, sheet.MaxCol); err != nil {
		return fmt.Errorf("insert new sheet: %w", err)
	}
	if _, err := s.db.Exec(`UPDATE workbooks SET active_sheet = ?, updated_at = ?, last_opened_at = ? WHERE id = ?`, name, now, now, workbookID); err != nil {
		return fmt.Errorf("set active sheet: %w", err)
	}
	return nil
}

func (s *Store) RenameSheet(workbookID, oldName, newName string) error {
	if oldName == newName {
		return nil
	}
	if _, _, err := s.getSheetMeta(workbookID, newName); err == nil {
		return ErrConflict
	} else if !errors.Is(err, ErrNotFound) {
		return err
	}

	meta, _, err := s.getSheetMeta(workbookID, oldName)
	if err != nil {
		return err
	}
	meta.Name = newName

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	result, err := tx.Exec(`
UPDATE sheets
SET name = ?, data_json = ?
WHERE workbook_id = ? AND name = ?
`, newName, string(buildSheetMetaJSON(meta)), workbookID, oldName)
	if err != nil {
		return fmt.Errorf("rename sheet row: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return ErrNotFound
	}
	if _, err := tx.Exec(`
UPDATE sheet_cells
SET sheet_name = ?
WHERE workbook_id = ? AND sheet_name = ?
`, newName, workbookID, oldName); err != nil {
		return fmt.Errorf("rename sheet cells: %w", err)
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := tx.Exec(`
UPDATE workbooks
SET active_sheet = CASE WHEN active_sheet = ? THEN ? ELSE active_sheet END,
    updated_at = ?,
    last_opened_at = ?
WHERE id = ?
`, oldName, newName, now, now, workbookID); err != nil {
		return fmt.Errorf("update active sheet on rename: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

func (s *Store) DeleteSheet(workbookID, name string) error {
	workbook, _, err := s.GetWorkbookByID(workbookID)
	if err != nil {
		return err
	}
	if len(workbook.Sheets) <= 1 {
		return ErrInvalid
	}

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	result, err := tx.Exec(`DELETE FROM sheets WHERE workbook_id = ? AND name = ?`, workbookID, name)
	if err != nil {
		return fmt.Errorf("delete sheet: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return ErrNotFound
	}

	nextActive := workbook.ActiveSheet
	if workbook.ActiveSheet == name {
		for _, meta := range workbook.Sheets {
			if meta.Name != name {
				nextActive = meta.Name
				break
			}
		}
	}
	if _, err := tx.Exec(`UPDATE workbooks SET active_sheet = ? WHERE id = ?`, nextActive, workbookID); err != nil {
		return fmt.Errorf("update active sheet on delete: %w", err)
	}
	if err := s.touchWorkbookTx(tx, workbookID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

func (s *Store) TouchWorkbookOpened(id string) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.Exec(`UPDATE workbooks SET last_opened_at = ? WHERE id = ?`, now, id)
	if err != nil {
		return fmt.Errorf("touch workbook opened: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) SetActiveSheet(id, sheetName string) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.Exec(`UPDATE workbooks SET active_sheet = ?, updated_at = ?, last_opened_at = ? WHERE id = ?`, sheetName, now, now, id)
	if err != nil {
		return fmt.Errorf("set active sheet: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) RenameWorkbook(id, fileName string) error {
	name := strings.TrimSpace(fileName)
	if name == "" {
		return ErrInvalid
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.Exec(`
UPDATE workbooks
SET file_name = ?, updated_at = ?
WHERE id = ?
`, name, now, id)
	if err != nil {
		return fmt.Errorf("rename workbook: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteWorkbook(id string) (string, error) {
	var filePath string
	err := s.db.QueryRow(`SELECT file_path FROM workbooks WHERE id = ?`, id).Scan(&filePath)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", fmt.Errorf("load workbook file path: %w", err)
	}

	result, err := s.db.Exec(`DELETE FROM workbooks WHERE id = ?`, id)
	if err != nil {
		return "", fmt.Errorf("delete workbook: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return "", ErrNotFound
	}
	return filePath, nil
}

func (s *Store) ListFiles(limit int) ([]models.FileEntry, error) {
	query := `
SELECT id, file_name, file_path, file_hash, created_at, updated_at, last_opened_at
FROM workbooks
ORDER BY updated_at DESC
`
	args := []any{}
	if limit > 0 {
		query += ` LIMIT ?`
		args = append(args, limit)
	}

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query files: %w", err)
	}
	defer func() { _ = rows.Close() }()

	entries := make([]models.FileEntry, 0)
	for rows.Next() {
		var e models.FileEntry
		var createdAt, updatedAt, lastOpenedAt string
		if err := rows.Scan(&e.ID, &e.FileName, &e.FilePath, &e.FileHash, &createdAt, &updatedAt, &lastOpenedAt); err != nil {
			return nil, fmt.Errorf("scan file entry: %w", err)
		}
		e.CreatedAt = parseTimeOrNow(createdAt)
		e.UpdatedAt = parseTimeOrNow(updatedAt)
		e.LastOpenedAt = parseTimeOrNow(lastOpenedAt)
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate files: %w", err)
	}
	return entries, nil
}

func (s *Store) ListRecentFiles(limit int) ([]models.FileEntry, error) {
	query := `
SELECT id, file_name, file_path, file_hash, created_at, updated_at, last_opened_at
FROM workbooks
ORDER BY last_opened_at DESC
`
	args := []any{}
	if limit > 0 {
		query += ` LIMIT ?`
		args = append(args, limit)
	}

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query recent files: %w", err)
	}
	defer func() { _ = rows.Close() }()

	entries := make([]models.FileEntry, 0)
	for rows.Next() {
		var e models.FileEntry
		var createdAt, updatedAt, lastOpenedAt string
		if err := rows.Scan(&e.ID, &e.FileName, &e.FilePath, &e.FileHash, &createdAt, &updatedAt, &lastOpenedAt); err != nil {
			return nil, fmt.Errorf("scan recent file: %w", err)
		}
		e.CreatedAt = parseTimeOrNow(createdAt)
		e.UpdatedAt = parseTimeOrNow(updatedAt)
		e.LastOpenedAt = parseTimeOrNow(lastOpenedAt)
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate recent files: %w", err)
	}
	return entries, nil
}

func (s *Store) GetFileSettings(workbookID string) (models.FileSettings, error) {
	exists, err := s.workbookExists(workbookID)
	if err != nil {
		return models.FileSettings{}, err
	}
	if !exists {
		return models.FileSettings{}, ErrNotFound
	}

	settings := defaultFileSettings()
	var smtpUseTLS int
	err = s.db.QueryRow(`
SELECT currency, smtp_host, smtp_port, smtp_username, smtp_password, smtp_from_email, smtp_from_name, smtp_use_tls
FROM file_settings
WHERE workbook_id = ?
`, workbookID).Scan(
		&settings.Currency,
		&settings.Email.Host,
		&settings.Email.Port,
		&settings.Email.Username,
		&settings.Email.Password,
		&settings.Email.FromEmail,
		&settings.Email.FromName,
		&smtpUseTLS,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return settings, nil
		}
		return models.FileSettings{}, fmt.Errorf("load file settings: %w", err)
	}
	settings.Currency = normalizeCurrency(settings.Currency)
	settings.Email = normalizeSMTP(settings.Email)
	settings.Email.UseTLS = smtpUseTLS == 1
	return settings, nil
}

func (s *Store) UpdateFileSettings(workbookID string, settings models.FileSettings) (models.FileSettings, error) {
	exists, err := s.workbookExists(workbookID)
	if err != nil {
		return models.FileSettings{}, err
	}
	if !exists {
		return models.FileSettings{}, ErrNotFound
	}

	normalized := models.FileSettings{
		Currency: normalizeCurrency(settings.Currency),
		Email:    normalizeSMTP(settings.Email),
	}

	tx, err := s.db.Begin()
	if err != nil {
		return models.FileSettings{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	smtpUseTLS := 0
	if normalized.Email.UseTLS {
		smtpUseTLS = 1
	}
	if _, err := tx.Exec(`
INSERT INTO file_settings(workbook_id, currency, smtp_host, smtp_port, smtp_username, smtp_password, smtp_from_email, smtp_from_name, smtp_use_tls)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(workbook_id) DO UPDATE SET
  currency=excluded.currency,
  smtp_host=excluded.smtp_host,
  smtp_port=excluded.smtp_port,
  smtp_username=excluded.smtp_username,
  smtp_password=excluded.smtp_password,
  smtp_from_email=excluded.smtp_from_email,
  smtp_from_name=excluded.smtp_from_name,
  smtp_use_tls=excluded.smtp_use_tls
`, workbookID, normalized.Currency, normalized.Email.Host, normalized.Email.Port, normalized.Email.Username, normalized.Email.Password, normalized.Email.FromEmail, normalized.Email.FromName, smtpUseTLS); err != nil {
		return models.FileSettings{}, fmt.Errorf("upsert file settings: %w", err)
	}
	if err := s.touchWorkbookTx(tx, workbookID); err != nil {
		return models.FileSettings{}, err
	}
	if err := tx.Commit(); err != nil {
		return models.FileSettings{}, fmt.Errorf("commit tx: %w", err)
	}
	return normalized, nil
}

func (s *Store) ListManagedDomains() ([]models.ManagedDomain, error) {
	rows, err := s.db.Query(`
SELECT domain, created_at
FROM managed_domains
ORDER BY domain ASC
`)
	if err != nil {
		return nil, fmt.Errorf("query managed domains: %w", err)
	}
	defer func() { _ = rows.Close() }()

	domains := make([]models.ManagedDomain, 0)
	for rows.Next() {
		var domain models.ManagedDomain
		var createdAt string
		if err := rows.Scan(&domain.Domain, &createdAt); err != nil {
			return nil, fmt.Errorf("scan managed domain: %w", err)
		}
		domain.CreatedAt = parseTimeOrNow(createdAt)
		domains = append(domains, domain)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate managed domains: %w", err)
	}
	return domains, nil
}

func (s *Store) UpsertManagedDomain(domain string) (models.ManagedDomain, error) {
	normalized := strings.TrimSpace(strings.ToLower(domain))
	if normalized == "" {
		return models.ManagedDomain{}, ErrInvalid
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := s.db.Exec(`
INSERT INTO managed_domains(domain, created_at)
VALUES(?, ?)
ON CONFLICT(domain) DO NOTHING
`, normalized, now); err != nil {
		return models.ManagedDomain{}, fmt.Errorf("upsert managed domain: %w", err)
	}

	var managed models.ManagedDomain
	var createdAt string
	if err := s.db.QueryRow(`
SELECT domain, created_at
FROM managed_domains
WHERE domain = ?
`, normalized).Scan(&managed.Domain, &createdAt); err != nil {
		return models.ManagedDomain{}, fmt.Errorf("load managed domain: %w", err)
	}
	managed.CreatedAt = parseTimeOrNow(createdAt)
	return managed, nil
}

func (s *Store) workbookExists(workbookID string) (bool, error) {
	var exists int
	if err := s.db.QueryRow(`SELECT 1 FROM workbooks WHERE id = ?`, workbookID).Scan(&exists); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("check workbook existence: %w", err)
	}
	return true, nil
}

func (s *Store) UpsertCell(workbookID, sheetName string, row, col int, value string) error {
	if err := s.ensureSheetIndexed(workbookID, sheetName); err != nil {
		return err
	}
	meta, _, err := s.getSheetMeta(workbookID, sheetName)
	if err != nil {
		return err
	}
	current, err := s.getStoredCell(workbookID, sheetName, row, col)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return err
	}
	if errors.Is(err, ErrNotFound) {
		current = storedCell{row: row, col: col}
	}
	current.row = row
	current.col = col
	current.value = value
	current.display = value
	current.formula = ""
	current.cellType = detectCellType(value)

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if err := s.upsertCellsTx(tx, workbookID, sheetName, []storedCell{current}); err != nil {
		return err
	}
	if row > meta.MaxRow || col > meta.MaxCol {
		meta.MaxRow = max(meta.MaxRow, row)
		meta.MaxCol = max(meta.MaxCol, col)
		if err := s.updateSheetMetaTx(tx, workbookID, meta); err != nil {
			return err
		}
	}
	if err := s.touchWorkbookTx(tx, workbookID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

func (s *Store) ExpandSheet(workbookID, sheetName string, addRows, addCols int) error {
	if addRows < 0 || addCols < 0 || (addRows == 0 && addCols == 0) {
		return ErrInvalid
	}
	if err := s.ensureSheetIndexed(workbookID, sheetName); err != nil {
		return err
	}
	meta, _, err := s.getSheetMeta(workbookID, sheetName)
	if err != nil {
		return err
	}
	meta.MaxRow = max(1, meta.MaxRow+addRows)
	meta.MaxCol = max(1, meta.MaxCol+addCols)

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := s.updateSheetMetaTx(tx, workbookID, meta); err != nil {
		return err
	}
	if err := s.touchWorkbookTx(tx, workbookID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

func (s *Store) ApplyStylePatch(workbookID, sheetName, mode string, row, col int, cellRange *models.CellRange, patch models.CellStylePatch) error {
	if err := s.ensureSheetIndexed(workbookID, sheetName); err != nil {
		return err
	}
	cells, meta, err := s.collectTargetCells(workbookID, sheetName, mode, row, col, cellRange, true)
	if err != nil {
		return err
	}
	for idx := range cells {
		style := cloneStyle(cells[idx].style)
		applyStylePatch(style, patch)
		if *style == (models.CellStyle{}) {
			cells[idx].style = nil
		} else {
			cells[idx].style = style
		}
		if cells[idx].cellType == "" {
			cells[idx].cellType = detectCellType(cells[idx].value)
		}
	}
	return s.persistCellsAndMeta(workbookID, sheetName, meta, cells)
}

func (s *Store) ClearFormatting(workbookID, sheetName, mode string, row, col int, cellRange *models.CellRange) error {
	if err := s.ensureSheetIndexed(workbookID, sheetName); err != nil {
		return err
	}
	if mode != "cell" {
		tx, err := s.db.Begin()
		if err != nil {
			return fmt.Errorf("begin tx: %w", err)
		}
		defer func() { _ = tx.Rollback() }()
		if err := clearFormattingTargetTx(tx, workbookID, sheetName, mode, row, col, cellRange); err != nil {
			return err
		}
		if err := s.touchWorkbookTx(tx, workbookID); err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit tx: %w", err)
		}
		return nil
	}
	cells, meta, err := s.collectTargetCells(workbookID, sheetName, mode, row, col, cellRange, mode == "cell")
	if err != nil {
		return err
	}
	for idx := range cells {
		cells[idx].style = nil
	}
	return s.persistCellsAndMeta(workbookID, sheetName, meta, cells)
}

func (s *Store) ClearValues(workbookID, sheetName, mode string, row, col int, cellRange *models.CellRange) error {
	if err := s.ensureSheetIndexed(workbookID, sheetName); err != nil {
		return err
	}
	if mode != "cell" {
		tx, err := s.db.Begin()
		if err != nil {
			return fmt.Errorf("begin tx: %w", err)
		}
		defer func() { _ = tx.Rollback() }()
		if err := clearValuesTargetTx(tx, workbookID, sheetName, mode, row, col, cellRange); err != nil {
			return err
		}
		if err := s.touchWorkbookTx(tx, workbookID); err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit tx: %w", err)
		}
		return nil
	}
	cells, meta, err := s.collectTargetCells(workbookID, sheetName, mode, row, col, cellRange, mode == "cell")
	if err != nil {
		return err
	}
	for idx := range cells {
		cells[idx].value = ""
		cells[idx].display = ""
		cells[idx].formula = ""
		cells[idx].cellType = "blank"
	}
	return s.persistCellsAndMeta(workbookID, sheetName, meta, cells)
}

func (s *Store) DeleteRows(workbookID, sheetName string, start, count int) error {
	if start < 1 || count < 1 {
		return ErrInvalid
	}
	if err := s.ensureSheetIndexed(workbookID, sheetName); err != nil {
		return err
	}
	meta, _, err := s.getSheetMeta(workbookID, sheetName)
	if err != nil {
		return err
	}
	end := start + count - 1

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.Exec(`
DELETE FROM sheet_cells
WHERE workbook_id = ? AND sheet_name = ? AND row_idx BETWEEN ? AND ?
`, workbookID, sheetName, start, end); err != nil {
		return fmt.Errorf("delete rows: %w", err)
	}
	tempOffset := max(meta.MaxRow, end) + count + 1
	if _, err := tx.Exec(`
UPDATE sheet_cells
SET row_idx = row_idx + ?
WHERE workbook_id = ? AND sheet_name = ? AND row_idx > ?
`, tempOffset, workbookID, sheetName, end); err != nil {
		return fmt.Errorf("stage row shift: %w", err)
	}
	if _, err := tx.Exec(`
UPDATE sheet_cells
SET row_idx = row_idx - ?
WHERE workbook_id = ? AND sheet_name = ? AND row_idx > ?
`, tempOffset+count, workbookID, sheetName, end+tempOffset); err != nil {
		return fmt.Errorf("finalize row shift: %w", err)
	}

	if start <= meta.MaxRow {
		deleted := min(count, meta.MaxRow-start+1)
		meta.MaxRow = max(1, meta.MaxRow-deleted)
	}
	if err := s.updateSheetMetaTx(tx, workbookID, meta); err != nil {
		return err
	}
	if err := s.touchWorkbookTx(tx, workbookID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

func (s *Store) InsertRows(workbookID, sheetName string, start, count int) error {
	if start < 1 || count < 1 {
		return ErrInvalid
	}
	if err := s.ensureSheetIndexed(workbookID, sheetName); err != nil {
		return err
	}
	meta, _, err := s.getSheetMeta(workbookID, sheetName)
	if err != nil {
		return err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	tempOffset := max(meta.MaxRow, start) + count + 1
	if _, err := tx.Exec(`
UPDATE sheet_cells
SET row_idx = row_idx + ?
WHERE workbook_id = ? AND sheet_name = ? AND row_idx >= ?
`, tempOffset, workbookID, sheetName, start); err != nil {
		return fmt.Errorf("stage row insert shift: %w", err)
	}
	if _, err := tx.Exec(`
UPDATE sheet_cells
SET row_idx = row_idx - ?
WHERE workbook_id = ? AND sheet_name = ? AND row_idx >= ?
`, tempOffset-count, workbookID, sheetName, start+tempOffset); err != nil {
		return fmt.Errorf("finalize row insert shift: %w", err)
	}

	meta.MaxRow = max(1, meta.MaxRow+count)
	if err := s.updateSheetMetaTx(tx, workbookID, meta); err != nil {
		return err
	}
	if err := s.touchWorkbookTx(tx, workbookID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

func (s *Store) DeleteCols(workbookID, sheetName string, start, count int) error {
	if start < 1 || count < 1 {
		return ErrInvalid
	}
	if err := s.ensureSheetIndexed(workbookID, sheetName); err != nil {
		return err
	}
	meta, _, err := s.getSheetMeta(workbookID, sheetName)
	if err != nil {
		return err
	}
	end := start + count - 1

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.Exec(`
DELETE FROM sheet_cells
WHERE workbook_id = ? AND sheet_name = ? AND col_idx BETWEEN ? AND ?
`, workbookID, sheetName, start, end); err != nil {
		return fmt.Errorf("delete cols: %w", err)
	}
	tempOffset := max(meta.MaxCol, end) + count + 1
	if _, err := tx.Exec(`
UPDATE sheet_cells
SET col_idx = col_idx + ?
WHERE workbook_id = ? AND sheet_name = ? AND col_idx > ?
`, tempOffset, workbookID, sheetName, end); err != nil {
		return fmt.Errorf("stage col shift: %w", err)
	}
	if _, err := tx.Exec(`
UPDATE sheet_cells
SET col_idx = col_idx - ?
WHERE workbook_id = ? AND sheet_name = ? AND col_idx > ?
`, tempOffset+count, workbookID, sheetName, end+tempOffset); err != nil {
		return fmt.Errorf("finalize col shift: %w", err)
	}

	if start <= meta.MaxCol {
		deleted := min(count, meta.MaxCol-start+1)
		meta.MaxCol = max(1, meta.MaxCol-deleted)
	}
	if err := s.updateSheetMetaTx(tx, workbookID, meta); err != nil {
		return err
	}
	if err := s.touchWorkbookTx(tx, workbookID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

func (s *Store) InsertCols(workbookID, sheetName string, start, count int) error {
	if start < 1 || count < 1 {
		return ErrInvalid
	}
	if err := s.ensureSheetIndexed(workbookID, sheetName); err != nil {
		return err
	}
	meta, _, err := s.getSheetMeta(workbookID, sheetName)
	if err != nil {
		return err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	tempOffset := max(meta.MaxCol, start) + count + 1
	if _, err := tx.Exec(`
UPDATE sheet_cells
SET col_idx = col_idx + ?
WHERE workbook_id = ? AND sheet_name = ? AND col_idx >= ?
`, tempOffset, workbookID, sheetName, start); err != nil {
		return fmt.Errorf("stage col insert shift: %w", err)
	}
	if _, err := tx.Exec(`
UPDATE sheet_cells
SET col_idx = col_idx - ?
WHERE workbook_id = ? AND sheet_name = ? AND col_idx >= ?
`, tempOffset-count, workbookID, sheetName, start+tempOffset); err != nil {
		return fmt.Errorf("finalize col insert shift: %w", err)
	}

	meta.MaxCol = max(1, meta.MaxCol+count)
	if err := s.updateSheetMetaTx(tx, workbookID, meta); err != nil {
		return err
	}
	if err := s.touchWorkbookTx(tx, workbookID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

func (s *Store) getStoredCell(workbookID, sheetName string, row, col int) (storedCell, error) {
	var rec storedCell
	var styleJSON string
	err := s.db.QueryRow(`
SELECT row_idx, col_idx, cell_type, value, display, formula, style_json
FROM sheet_cells
WHERE workbook_id = ? AND sheet_name = ? AND row_idx = ? AND col_idx = ?
`, workbookID, sheetName, row, col).Scan(&rec.row, &rec.col, &rec.cellType, &rec.value, &rec.display, &rec.formula, &styleJSON)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return storedCell{}, ErrNotFound
		}
		return storedCell{}, fmt.Errorf("load stored cell: %w", err)
	}
	style, err := decodeStyle(styleJSON)
	if err != nil {
		return storedCell{}, fmt.Errorf("decode stored cell style: %w", err)
	}
	rec.style = style
	return rec, nil
}

func (s *Store) collectTargetCells(workbookID, sheetName, mode string, row, col int, cellRange *models.CellRange, createMissing bool) ([]storedCell, models.Sheet, error) {
	meta, _, err := s.getSheetMeta(workbookID, sheetName)
	if err != nil {
		return nil, models.Sheet{}, err
	}
	cells, err := s.queryTargetCells(workbookID, sheetName, mode, row, col, cellRange)
	if err != nil {
		return nil, models.Sheet{}, err
	}
	if !createMissing {
		return cells, meta, nil
	}

	cellMap := make(map[string]storedCell, len(cells))
	for _, cell := range cells {
		cellMap[cellKey(cell.row, cell.col)] = cell
	}

	switch mode {
	case "cell":
		key := cellKey(row, col)
		if _, ok := cellMap[key]; !ok {
			cellMap[key] = storedCell{row: row, col: col, cellType: "blank"}
			meta.MaxRow = max(meta.MaxRow, row)
			meta.MaxCol = max(meta.MaxCol, col)
		}
	case "range":
		if cellRange != nil && rangeArea(*cellRange) <= maxCreateRangeArea {
			for r := cellRange.RowStart; r <= cellRange.RowEnd; r += 1 {
				for c := cellRange.ColStart; c <= cellRange.ColEnd; c += 1 {
					key := cellKey(r, c)
					if _, ok := cellMap[key]; ok {
						continue
					}
					cellMap[key] = storedCell{row: r, col: c, cellType: "blank"}
				}
			}
			meta.MaxRow = max(meta.MaxRow, cellRange.RowEnd)
			meta.MaxCol = max(meta.MaxCol, cellRange.ColEnd)
		}
	}

	result := make([]storedCell, 0, len(cellMap))
	for _, cell := range cellMap {
		result = append(result, cell)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].row == result[j].row {
			return result[i].col < result[j].col
		}
		return result[i].row < result[j].row
	})
	return result, meta, nil
}

func (s *Store) queryTargetCells(workbookID, sheetName, mode string, row, col int, cellRange *models.CellRange) ([]storedCell, error) {
	query := `
SELECT row_idx, col_idx, cell_type, value, display, formula, style_json
FROM sheet_cells
WHERE workbook_id = ? AND sheet_name = ?`
	args := []any{workbookID, sheetName}

	switch mode {
	case "sheet":
		// no extra predicate
	case "column":
		query += ` AND col_idx = ?`
		args = append(args, col)
	case "range":
		if cellRange == nil {
			return nil, ErrInvalid
		}
		query += ` AND row_idx BETWEEN ? AND ? AND col_idx BETWEEN ? AND ?`
		args = append(args, cellRange.RowStart, cellRange.RowEnd, cellRange.ColStart, cellRange.ColEnd)
	case "cell", "":
		query += ` AND row_idx = ? AND col_idx = ?`
		args = append(args, row, col)
	default:
		return nil, ErrInvalid
	}
	query += ` ORDER BY row_idx ASC, col_idx ASC`

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query target cells: %w", err)
	}
	defer func() { _ = rows.Close() }()

	result := make([]storedCell, 0)
	for rows.Next() {
		var rec storedCell
		var styleJSON string
		if err := rows.Scan(&rec.row, &rec.col, &rec.cellType, &rec.value, &rec.display, &rec.formula, &styleJSON); err != nil {
			return nil, fmt.Errorf("scan target cell: %w", err)
		}
		style, err := decodeStyle(styleJSON)
		if err != nil {
			return nil, fmt.Errorf("decode target cell style: %w", err)
		}
		rec.style = style
		result = append(result, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate target cells: %w", err)
	}
	return result, nil
}

func clearFormattingTargetTx(tx *sql.Tx, workbookID, sheetName, mode string, row, col int, cellRange *models.CellRange) error {
	query := `
UPDATE sheet_cells
SET style_json = '{}'
WHERE workbook_id = ? AND sheet_name = ?`
	args := []any{workbookID, sheetName}
	switch mode {
	case "sheet":
		// no extra predicate
	case "column":
		query += ` AND col_idx = ?`
		args = append(args, col)
	case "range":
		if cellRange == nil {
			return ErrInvalid
		}
		query += ` AND row_idx BETWEEN ? AND ? AND col_idx BETWEEN ? AND ?`
		args = append(args, cellRange.RowStart, cellRange.RowEnd, cellRange.ColStart, cellRange.ColEnd)
	case "cell", "":
		query += ` AND row_idx = ? AND col_idx = ?`
		args = append(args, row, col)
	default:
		return ErrInvalid
	}
	if _, err := tx.Exec(query, args...); err != nil {
		return fmt.Errorf("clear formatting target: %w", err)
	}
	return nil
}

func clearValuesTargetTx(tx *sql.Tx, workbookID, sheetName, mode string, row, col int, cellRange *models.CellRange) error {
	query := `
UPDATE sheet_cells
SET value = '', display = '', formula = '', cell_type = 'blank'
WHERE workbook_id = ? AND sheet_name = ?`
	args := []any{workbookID, sheetName}
	switch mode {
	case "sheet":
		// no extra predicate
	case "column":
		query += ` AND col_idx = ?`
		args = append(args, col)
	case "range":
		if cellRange == nil {
			return ErrInvalid
		}
		query += ` AND row_idx BETWEEN ? AND ? AND col_idx BETWEEN ? AND ?`
		args = append(args, cellRange.RowStart, cellRange.RowEnd, cellRange.ColStart, cellRange.ColEnd)
	case "cell", "":
		query += ` AND row_idx = ? AND col_idx = ?`
		args = append(args, row, col)
	default:
		return ErrInvalid
	}
	if _, err := tx.Exec(query, args...); err != nil {
		return fmt.Errorf("clear values target: %w", err)
	}
	return nil
}

func (s *Store) persistCellsAndMeta(workbookID, sheetName string, meta models.Sheet, cells []storedCell) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := s.upsertCellsTx(tx, workbookID, sheetName, cells); err != nil {
		return err
	}
	if err := s.updateSheetMetaTx(tx, workbookID, meta); err != nil {
		return err
	}
	if err := s.touchWorkbookTx(tx, workbookID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

func (s *Store) updateSheetMetaTx(tx *sql.Tx, workbookID string, sheet models.Sheet) error {
	result, err := tx.Exec(`
UPDATE sheets
SET sheet_index = ?, data_json = ?, max_row = ?, max_col = ?
WHERE workbook_id = ? AND name = ?
`, sheet.Index, string(buildSheetMetaJSON(sheet)), sheet.MaxRow, sheet.MaxCol, workbookID, sheet.Name)
	if err != nil {
		return fmt.Errorf("update sheet meta: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) upsertCellsTx(tx *sql.Tx, workbookID, sheetName string, cells []storedCell) error {
	deleteStmt, err := tx.Prepare(`DELETE FROM sheet_cells WHERE workbook_id = ? AND sheet_name = ? AND row_idx = ? AND col_idx = ?`)
	if err != nil {
		return fmt.Errorf("prepare delete cell: %w", err)
	}
	defer func() { _ = deleteStmt.Close() }()
	upsertStmt, err := tx.Prepare(`
INSERT INTO sheet_cells(workbook_id, sheet_name, row_idx, col_idx, cell_type, value, display, formula, style_json)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(workbook_id, sheet_name, row_idx, col_idx) DO UPDATE SET
  cell_type = excluded.cell_type,
  value = excluded.value,
  display = excluded.display,
  formula = excluded.formula,
  style_json = excluded.style_json
`)
	if err != nil {
		return fmt.Errorf("prepare upsert cell: %w", err)
	}
	defer func() { _ = upsertStmt.Close() }()

	for _, cell := range cells {
		if isEmptyStoredCell(cell) {
			if _, err := deleteStmt.Exec(workbookID, sheetName, cell.row, cell.col); err != nil {
				return fmt.Errorf("delete empty cell: %w", err)
			}
			continue
		}
		styleJSON, err := encodeStyle(cell.style)
		if err != nil {
			return fmt.Errorf("encode style: %w", err)
		}
		if _, err := upsertStmt.Exec(workbookID, sheetName, cell.row, cell.col, cell.cellType, cell.value, cell.display, cell.formula, styleJSON); err != nil {
			return fmt.Errorf("upsert cell: %w", err)
		}
	}
	return nil
}

func (s *Store) insertCellsTx(tx *sql.Tx, workbookID, sheetName string, rows []models.Row) error {
	stmt, err := tx.Prepare(`
INSERT INTO sheet_cells(workbook_id, sheet_name, row_idx, col_idx, cell_type, value, display, formula, style_json)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
	if err != nil {
		return fmt.Errorf("prepare insert cells: %w", err)
	}
	defer func() { _ = stmt.Close() }()

	for _, row := range rows {
		for _, cell := range row.Cells {
			styleJSON, err := encodeStyle(cell.Style)
			if err != nil {
				return fmt.Errorf("encode style for %s: %w", cell.Address, err)
			}
			if _, err := stmt.Exec(workbookID, sheetName, cell.Row, cell.Col, cell.Type, cell.Value, cell.Display, cell.Formula, styleJSON); err != nil {
				return fmt.Errorf("insert cell %s: %w", cell.Address, err)
			}
		}
	}
	return nil
}

func (s *Store) getSheetMeta(workbookID, name string) (models.Sheet, string, error) {
	var sheet models.Sheet
	var dataJSON string
	err := s.db.QueryRow(`
SELECT name, sheet_index, max_row, max_col, data_json
FROM sheets
WHERE workbook_id = ? AND name = ?
`, workbookID, name).Scan(&sheet.Name, &sheet.Index, &sheet.MaxRow, &sheet.MaxCol, &dataJSON)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.Sheet{}, "", ErrNotFound
		}
		return models.Sheet{}, "", fmt.Errorf("load sheet meta: %w", err)
	}
	sheet.Rows = []models.Row{}
	if sheet.MaxRow == 0 && sheet.MaxCol == 0 && dataJSON != "" {
		legacy, legacyErr := decodeLegacySheet(dataJSON)
		if legacyErr == nil {
			sheet.MaxRow = legacy.MaxRow
			sheet.MaxCol = legacy.MaxCol
		}
	}
	if sheet.MaxRow == 0 && sheet.MaxCol == 0 {
		cellMaxRow, cellMaxCol, err := s.getStoredSheetBounds(workbookID, name)
		if err != nil {
			return models.Sheet{}, "", err
		}
		sheet.MaxRow = cellMaxRow
		sheet.MaxCol = cellMaxCol
	}
	return sheet, dataJSON, nil
}

func (s *Store) getStoredSheetBounds(workbookID, sheetName string) (int, int, error) {
	var maxRow, maxCol int
	if err := s.db.QueryRow(`
SELECT COALESCE(MAX(row_idx), 0), COALESCE(MAX(col_idx), 0)
FROM sheet_cells
WHERE workbook_id = ? AND sheet_name = ?
`, workbookID, sheetName).Scan(&maxRow, &maxCol); err != nil {
		return 0, 0, fmt.Errorf("load sheet bounds: %w", err)
	}
	return maxRow, maxCol, nil
}

func (s *Store) ensureSheetIndexed(workbookID, name string) error {
	meta, dataJSON, err := s.getSheetMeta(workbookID, name)
	if err != nil {
		return err
	}
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(1) FROM sheet_cells WHERE workbook_id = ? AND sheet_name = ?`, workbookID, name).Scan(&count); err != nil {
		return fmt.Errorf("count sheet cells: %w", err)
	}
	if count > 0 || dataJSON == "" || dataJSON == string(buildSheetMetaJSON(meta)) {
		return nil
	}
	legacy, err := decodeLegacySheet(dataJSON)
	if err != nil {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`DELETE FROM sheet_cells WHERE workbook_id = ? AND sheet_name = ?`, workbookID, name); err != nil {
		return fmt.Errorf("clear legacy cells: %w", err)
	}
	if err := s.insertCellsTx(tx, workbookID, name, legacy.Rows); err != nil {
		return err
	}
	legacy.Rows = []models.Row{}
	if err := s.updateSheetMetaTx(tx, workbookID, legacy); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

func (s *Store) touchWorkbookTx(tx *sql.Tx, workbookID string) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := tx.Exec(`UPDATE workbooks SET updated_at = ?, last_opened_at = ? WHERE id = ?`, now, now, workbookID); err != nil {
		return fmt.Errorf("update workbook timestamps: %w", err)
	}
	return nil
}

func buildSheetMetaJSON(sheet models.Sheet) []byte {
	payload, _ := json.Marshal(models.Sheet{
		Name:   sheet.Name,
		Index:  sheet.Index,
		MaxRow: sheet.MaxRow,
		MaxCol: sheet.MaxCol,
		Rows:   []models.Row{},
	})
	return payload
}

func decodeLegacySheet(data string) (models.Sheet, error) {
	var sheet models.Sheet
	if err := json.Unmarshal([]byte(data), &sheet); err != nil {
		return models.Sheet{}, err
	}
	if sheet.MaxRow == 0 && len(sheet.Rows) > 0 {
		sheet.MaxRow = sheet.Rows[len(sheet.Rows)-1].Index
	}
	return sheet, nil
}

func encodeStyle(style *models.CellStyle) (string, error) {
	if style == nil || *style == (models.CellStyle{}) {
		return "", nil
	}
	payload, err := json.Marshal(style)
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

func decodeStyle(styleJSON string) (*models.CellStyle, error) {
	if styleJSON == "" {
		return nil, nil
	}
	var style models.CellStyle
	if err := json.Unmarshal([]byte(styleJSON), &style); err != nil {
		return nil, err
	}
	if style == (models.CellStyle{}) {
		return nil, nil
	}
	return &style, nil
}

func cloneStyle(style *models.CellStyle) *models.CellStyle {
	if style == nil {
		return &models.CellStyle{}
	}
	copy := *style
	return &copy
}

func applyStylePatch(style *models.CellStyle, patch models.CellStylePatch) {
	if patch.FontFamily != nil {
		style.FontFamily = *patch.FontFamily
	}
	if patch.FontSize != nil {
		style.FontSize = *patch.FontSize
	}
	if patch.Bold != nil {
		style.Bold = *patch.Bold
	}
	if patch.Italic != nil {
		style.Italic = *patch.Italic
	}
	if patch.Underline != nil {
		style.Underline = *patch.Underline
	}
	if patch.Strike != nil {
		style.Strike = *patch.Strike
	}
	if patch.FontColor != nil {
		style.FontColor = *patch.FontColor
	}
	if patch.FillColor != nil {
		style.FillColor = *patch.FillColor
	}
	if patch.HAlign != nil {
		style.HAlign = *patch.HAlign
	}
	if patch.VAlign != nil {
		style.VAlign = *patch.VAlign
	}
	if patch.Border != nil {
		style.Border = *patch.Border
	}
	if patch.Overflow != nil {
		style.Overflow = *patch.Overflow
	}
	if patch.WrapText != nil {
		style.WrapText = *patch.WrapText
	}
	if patch.NumFmt != nil {
		style.NumFmt = *patch.NumFmt
	}
}

func isEmptyStoredCell(cell storedCell) bool {
	return cell.value == "" && cell.display == "" && cell.formula == "" && (cell.style == nil || *cell.style == (models.CellStyle{}))
}

func cellKey(row, col int) string {
	return fmt.Sprintf("%d:%d", row, col)
}

func rangeArea(cellRange models.CellRange) int {
	return max(0, cellRange.RowEnd-cellRange.RowStart+1) * max(0, cellRange.ColEnd-cellRange.ColStart+1)
}

func detectCellType(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "blank"
	}
	if trimmed == "true" || trimmed == "false" || trimmed == "TRUE" || trimmed == "FALSE" {
		return "boolean"
	}
	isNum := true
	for i := 0; i < len(trimmed); i++ {
		ch := trimmed[i]
		if !((ch >= '0' && ch <= '9') || ch == '.' || ch == '-' || ch == '+') {
			isNum = false
			break
		}
	}
	if isNum {
		return "number"
	}
	return "string"
}

func toAddress(row, col int) string {
	return toColumnLabel(col) + itoa(row)
}

func toColumnLabel(index int) string {
	label := ""
	for index > 0 {
		offset := (index - 1) % 26
		label = string(rune('A'+offset)) + label
		index = (index - 1) / 26
	}
	return label
}

func itoa(value int) string {
	return fmt.Sprintf("%d", value)
}

func parseTimeOrNow(value string) time.Time {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Now().UTC()
	}
	return parsed
}

func defaultFileSettings() models.FileSettings {
	return models.FileSettings{
		Currency: defaultFileCurrency,
		Email: models.SMTPSettings{
			Host:      "",
			Port:      defaultSMTPPort,
			Username:  "",
			Password:  "",
			FromEmail: "",
			FromName:  "",
			UseTLS:    true,
		},
	}
}

func normalizeCurrency(currency string) string {
	normalized := strings.ToUpper(strings.TrimSpace(currency))
	if len(normalized) != 3 {
		return defaultFileCurrency
	}
	for i := 0; i < len(normalized); i++ {
		ch := normalized[i]
		if ch < 'A' || ch > 'Z' {
			return defaultFileCurrency
		}
	}
	return normalized
}

func normalizeSMTP(email models.SMTPSettings) models.SMTPSettings {
	normalized := models.SMTPSettings{
		Host:      strings.TrimSpace(email.Host),
		Port:      email.Port,
		Username:  strings.TrimSpace(email.Username),
		Password:  strings.TrimSpace(email.Password),
		FromEmail: strings.TrimSpace(email.FromEmail),
		FromName:  strings.TrimSpace(email.FromName),
		UseTLS:    email.UseTLS,
	}
	if normalized.Port <= 0 || normalized.Port > 65535 {
		normalized.Port = defaultSMTPPort
	}
	return normalized
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

var (
	ErrNotFound  = errors.New("not found")
	ErrConflict  = errors.New("conflict")
	ErrInvalid   = errors.New("invalid")
	ErrForbidden = errors.New("forbidden")
)
