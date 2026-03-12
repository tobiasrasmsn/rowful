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

func TestRecalculateFormulaCellsSupportsAggregateFunctions(t *testing.T) {
	cells := []storedCell{
		{row: 1, col: 1, value: "2", display: "2", cellType: "number"},
		{row: 1, col: 2, value: "4", display: "4", cellType: "number"},
		{row: 2, col: 1, value: "6", display: "6", cellType: "number"},
		{row: 2, col: 2, value: "notes", display: "notes", cellType: "text"},
		{row: 3, col: 1, formula: "AVERAGE(A1:A2)", cellType: "formula"},
		{row: 3, col: 2, formula: "MIN(A1:B2)", cellType: "formula"},
		{row: 3, col: 3, formula: "MAX(A1:B2)", cellType: "formula"},
		{row: 3, col: 4, formula: "COUNT(A1:B2)", cellType: "formula"},
		{row: 3, col: 5, formula: "COUNTA(A1:B2)", cellType: "formula"},
	}

	recalculated := recalculateFormulaCells(cells)

	assertFormulaValue(t, recalculated, 3, 1, "4")
	assertFormulaValue(t, recalculated, 3, 2, "2")
	assertFormulaValue(t, recalculated, 3, 3, "6")
	assertFormulaValue(t, recalculated, 3, 4, "3")
	assertFormulaValue(t, recalculated, 3, 5, "4")
}

func TestRecalculateFormulaCellsSupportsLogicAndUtilityFunctions(t *testing.T) {
	cells := []storedCell{
		{row: 1, col: 1, value: "8", display: "8", cellType: "number"},
		{row: 1, col: 2, value: "-3.456", display: "-3.456", cellType: "number"},
		{row: 1, col: 3, value: "hello", display: "hello", cellType: "text"},
		{row: 2, col: 1, formula: `IF(A1>5,"big","small")`, cellType: "formula"},
		{row: 2, col: 2, formula: "ROUND(B1,2)", cellType: "formula"},
		{row: 2, col: 3, formula: "ABS(B1)", cellType: "formula"},
		{row: 2, col: 4, formula: "LEN(C1)", cellType: "formula"},
	}

	recalculated := recalculateFormulaCells(cells)

	assertFormulaValue(t, recalculated, 2, 1, "big")
	assertFormulaValue(t, recalculated, 2, 2, "-3.46")
	assertFormulaValue(t, recalculated, 2, 3, "3.456")
	assertFormulaValue(t, recalculated, 2, 4, "5")
}

func TestRecalculateFormulaCellsSupportsConditionalAndLookupFunctions(t *testing.T) {
	cells := []storedCell{
		{row: 1, col: 1, value: "apples", display: "apples", cellType: "text"},
		{row: 2, col: 1, value: "oranges", display: "oranges", cellType: "text"},
		{row: 3, col: 1, value: "apples", display: "apples", cellType: "text"},
		{row: 4, col: 1, value: "pears", display: "pears", cellType: "text"},
		{row: 1, col: 2, value: "2", display: "2", cellType: "number"},
		{row: 2, col: 2, value: "4", display: "4", cellType: "number"},
		{row: 3, col: 2, value: "6", display: "6", cellType: "number"},
		{row: 4, col: 2, value: "8", display: "8", cellType: "number"},
		{row: 5, col: 1, formula: `SUMIF(A1:A4,"apples",B1:B4)`, cellType: "formula"},
		{row: 5, col: 2, formula: `AVERAGEIF(B1:B4,">4")`, cellType: "formula"},
		{row: 5, col: 3, formula: "INDEX(B1:B4,3)", cellType: "formula"},
		{row: 5, col: 4, formula: `MATCH("oranges",A1:A4,0)`, cellType: "formula"},
	}

	recalculated := recalculateFormulaCells(cells)

	assertFormulaValue(t, recalculated, 5, 1, "8")
	assertFormulaValue(t, recalculated, 5, 2, "7")
	assertFormulaValue(t, recalculated, 5, 3, "6")
	assertFormulaValue(t, recalculated, 5, 4, "2")
}

func TestUpsertCellRecalculatesConditionalFormulaOnSourceUpdate(t *testing.T) {
	store := newTestStore(t)
	workbookID := seedTestWorkbook(t, store)

	if err := store.UpsertCell(workbookID, "Sheet1", 1, 1, "apples"); err != nil {
		t.Fatalf("seed A1: %v", err)
	}
	if err := store.UpsertCell(workbookID, "Sheet1", 2, 1, "oranges"); err != nil {
		t.Fatalf("seed A2: %v", err)
	}
	if err := store.UpsertCell(workbookID, "Sheet1", 1, 2, "2"); err != nil {
		t.Fatalf("seed B1: %v", err)
	}
	if err := store.UpsertCell(workbookID, "Sheet1", 2, 2, "4"); err != nil {
		t.Fatalf("seed B2: %v", err)
	}
	if err := store.UpsertCell(workbookID, "Sheet1", 3, 1, `=SUMIF(A1:A2,"apples",B1:B2)`); err != nil {
		t.Fatalf("write formula: %v", err)
	}

	formulaCell, err := store.getStoredCell(workbookID, "Sheet1", 3, 1)
	if err != nil {
		t.Fatalf("load formula cell: %v", err)
	}
	if formulaCell.value != "2" {
		t.Fatalf("expected computed value 2, got %q", formulaCell.value)
	}

	if err := store.UpsertCell(workbookID, "Sheet1", 2, 1, "apples"); err != nil {
		t.Fatalf("update source cell: %v", err)
	}

	recalculatedCell, err := store.getStoredCell(workbookID, "Sheet1", 3, 1)
	if err != nil {
		t.Fatalf("reload formula cell: %v", err)
	}
	if recalculatedCell.value != "6" {
		t.Fatalf("expected recalculated value 6, got %q", recalculatedCell.value)
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

func assertFormulaValue(t *testing.T, cells []storedCell, row, col int, want string) {
	t.Helper()

	for _, cell := range cells {
		if cell.row == row && cell.col == col {
			if cell.value != want {
				t.Fatalf("expected cell (%d,%d) to be %q, got %q", row, col, want, cell.value)
			}
			if cell.display != want {
				t.Fatalf("expected cell (%d,%d) display to be %q, got %q", row, col, want, cell.display)
			}
			return
		}
	}

	t.Fatalf("expected recalculated cell (%d,%d)", row, col)
}
