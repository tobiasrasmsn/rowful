package parser

import (
	"bytes"
	"testing"

	"github.com/xuri/excelize/v2"
)

func TestParseWorkbookDefaultsImportedCellsToClipOverflow(t *testing.T) {
	workbook := excelize.NewFile()
	defer func() { _ = workbook.Close() }()

	const sheetName = "Sheet1"
	if err := workbook.SetCellValue(sheetName, "A1", "https://example.com/very/long/link"); err != nil {
		t.Fatalf("set cell value: %v", err)
	}

	buffer, err := workbook.WriteToBuffer()
	if err != nil {
		t.Fatalf("write workbook: %v", err)
	}

	parsed, err := ParseWorkbook(buffer.Bytes())
	if err != nil {
		t.Fatalf("parse workbook: %v", err)
	}

	cell := parsed[sheetName].Rows[0].Cells[0]
	if cell.Style == nil {
		t.Fatalf("expected imported cell style to be present")
	}
	if cell.Style.Overflow != "clip" {
		t.Fatalf("expected imported cells to default to clip overflow, got %q", cell.Style.Overflow)
	}
	if cell.Style.WrapText {
		t.Fatalf("expected imported cells without wrap to keep wrapText false")
	}
}

func TestParseWorkbookPreservesWrappedImportedCells(t *testing.T) {
	workbook := excelize.NewFile()
	defer func() { _ = workbook.Close() }()

	const sheetName = "Sheet1"
	styleID, err := workbook.NewStyle(&excelize.Style{
		Alignment: &excelize.Alignment{WrapText: true},
	})
	if err != nil {
		t.Fatalf("create style: %v", err)
	}
	if err := workbook.SetCellValue(sheetName, "A1", "wrapped content"); err != nil {
		t.Fatalf("set cell value: %v", err)
	}
	if err := workbook.SetCellStyle(sheetName, "A1", "A1", styleID); err != nil {
		t.Fatalf("set cell style: %v", err)
	}

	buffer := bytes.NewBuffer(nil)
	if _, err := workbook.WriteTo(buffer); err != nil {
		t.Fatalf("write workbook: %v", err)
	}

	parsed, err := ParseWorkbook(buffer.Bytes())
	if err != nil {
		t.Fatalf("parse workbook: %v", err)
	}

	cell := parsed[sheetName].Rows[0].Cells[0]
	if cell.Style == nil {
		t.Fatalf("expected wrapped imported cell style to be present")
	}
	if !cell.Style.WrapText {
		t.Fatalf("expected wrapped imported cells to preserve wrapText")
	}
	if cell.Style.Overflow != "wrap" {
		t.Fatalf("expected wrapped imported cells to normalize to wrap overflow, got %q", cell.Style.Overflow)
	}
}
