package storage

import (
	"path/filepath"
	"testing"
	"time"

	"planar/models"
)

func TestUpsertCellPersistsAndRecalculatesSumFormula(t *testing.T) {
	store := newTestStore(t)
	workbookID := seedTestWorkbook(t, store)

	if err := store.UpsertCell(workbookID, "Sheet1", 1, 1, "2"); err != nil {
		t.Fatalf("seed A1: %v", err)
	}
	if err := store.UpsertCell(workbookID, "Sheet1", 1, 2, "3"); err != nil {
		t.Fatalf("seed B1: %v", err)
	}
	if err := store.UpsertCell(workbookID, "Sheet1", 2, 1, "=SUM(A1:B1)"); err != nil {
		t.Fatalf("write formula: %v", err)
	}

	formulaCell, err := store.getStoredCell(workbookID, "Sheet1", 2, 1)
	if err != nil {
		t.Fatalf("load formula cell: %v", err)
	}
	if formulaCell.formula != "SUM(A1:B1)" {
		t.Fatalf("expected stored formula, got %q", formulaCell.formula)
	}
	if formulaCell.value != "5" {
		t.Fatalf("expected computed value 5, got %q", formulaCell.value)
	}
	if formulaCell.display != "5" {
		t.Fatalf("expected computed display 5, got %q", formulaCell.display)
	}

	if err := store.UpsertCell(workbookID, "Sheet1", 1, 1, "10"); err != nil {
		t.Fatalf("update source cell: %v", err)
	}

	recalculatedCell, err := store.getStoredCell(workbookID, "Sheet1", 2, 1)
	if err != nil {
		t.Fatalf("reload formula cell: %v", err)
	}
	if recalculatedCell.value != "13" {
		t.Fatalf("expected recalculated value 13, got %q", recalculatedCell.value)
	}
}

func TestRecalculateFormulaCellsMarksInvalidFormula(t *testing.T) {
	cells := []storedCell{
		{row: 1, col: 1, formula: "SUM(", cellType: "formula"},
	}

	recalculated := recalculateFormulaCells(cells)
	if len(recalculated) != 1 {
		t.Fatalf("expected 1 recalculated cell, got %d", len(recalculated))
	}
	if recalculated[0].display != formulaErrorDisplay {
		t.Fatalf("expected %q, got %q", formulaErrorDisplay, recalculated[0].display)
	}
}

func newTestStore(t *testing.T) *Store {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "planar-test.db")
	store, err := New(dbPath)
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	t.Cleanup(func() {
		_ = store.db.Close()
	})
	return store
}

func seedTestWorkbook(t *testing.T, store *Store) string {
	t.Helper()

	user, err := store.CreateUser("Test User", "test@example.com", "hash")
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}

	workbookID := "wb-test"
	workbook := models.Workbook{
		ID:          workbookID,
		FileName:    "test.xlsx",
		FileHash:    "hash-test",
		ActiveSheet: "Sheet1",
		CreatedAt:   time.Now().UTC(),
	}
	sheet := models.Sheet{
		Name:   "Sheet1",
		Index:  0,
		MaxRow: 10,
		MaxCol: 10,
		Rows:   []models.Row{},
	}
	if err := store.SaveWorkbook(user.ID, workbook, map[string]models.Sheet{
		sheet.Name: sheet,
	}, ""); err != nil {
		t.Fatalf("seed workbook: %v", err)
	}
	return workbookID
}
