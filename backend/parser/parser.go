package parser

import (
	"bytes"
	"fmt"
	"sort"
	"strings"

	"github.com/xuri/excelize/v2"

	"rowful/models"
)

func ParseWorkbook(fileBytes []byte) (map[string]models.Sheet, error) {
	xlsx, err := excelize.OpenReader(bytes.NewReader(fileBytes))
	if err != nil {
		return nil, fmt.Errorf("open workbook: %w", err)
	}
	defer func() { _ = xlsx.Close() }()

	sheetNames := xlsx.GetSheetList()
	if len(sheetNames) == 0 {
		return nil, fmt.Errorf("workbook has no sheets")
	}

	resolver := newStyleResolver(xlsx)
	result := make(map[string]models.Sheet, len(sheetNames))

	for index, sheetName := range sheetNames {
		sheet, parseErr := parseSheet(xlsx, resolver, sheetName, index)
		if parseErr != nil {
			return nil, parseErr
		}
		result[sheetName] = sheet
	}

	return result, nil
}

func parseSheet(xlsx *excelize.File, resolver *styleResolver, sheetName string, index int) (models.Sheet, error) {
	rowsData, err := xlsx.GetRows(sheetName)
	if err != nil {
		return models.Sheet{}, fmt.Errorf("read sheet %q rows: %w", sheetName, err)
	}
	maxRow, maxCol := sheetBounds(xlsx, sheetName)

	rows := make([]models.Row, 0, len(rowsData))
	maxObservedCol := 0

	for rowIndex, rowData := range rowsData {
		cells := make([]models.Cell, 0, len(rowData))

		for colIndex := range rowData {
			cellName, coordErr := excelize.CoordinatesToCellName(colIndex+1, rowIndex+1)
			if coordErr != nil {
				continue
			}

			rawValue, _ := xlsx.GetCellValue(sheetName, cellName, excelize.Options{RawCellValue: true})
			displayValue, _ := xlsx.GetCellValue(sheetName, cellName)
			formula, _ := xlsx.GetCellFormula(sheetName, cellName)

			if rawValue == "" && displayValue == "" && formula == "" {
				continue
			}

			cell := models.Cell{
				Address: cellName,
				Row:     rowIndex + 1,
				Col:     colIndex + 1,
				Type:    detectCellType(rawValue, displayValue, formula),
				Value:   rawValue,
				Display: displayValue,
				Formula: formula,
				Style:   normalizeImportedCellStyle(resolver.Resolve(sheetName, cellName)),
			}

			cells = append(cells, cell)
			if colIndex+1 > maxObservedCol {
				maxObservedCol = colIndex + 1
			}
		}

		if len(cells) == 0 {
			continue
		}

		rows = append(rows, models.Row{Index: rowIndex + 1, Cells: cells})
	}

	sort.Slice(rows, func(i, j int) bool {
		return rows[i].Index < rows[j].Index
	})

	maxObservedRow := 0
	if len(rows) > 0 {
		maxObservedRow = rows[len(rows)-1].Index
	}
	if maxObservedRow > maxRow {
		maxRow = maxObservedRow
	}
	if maxObservedCol > maxCol {
		maxCol = maxObservedCol
	}

	return models.Sheet{
		Name:   sheetName,
		Index:  index,
		MaxRow: maxRow,
		MaxCol: maxCol,
		Rows:   rows,
	}, nil
}

func normalizeImportedCellStyle(style *models.CellStyle) *models.CellStyle {
	if style == nil {
		return &models.CellStyle{Overflow: "clip"}
	}

	normalized := *style
	if normalized.WrapText {
		if normalized.Overflow == "" {
			normalized.Overflow = "wrap"
		}
	} else if normalized.Overflow == "" {
		normalized.Overflow = "clip"
	}

	return &normalized
}

func ReadWorkbookDimensionsFromFile(filePath string) (map[string]models.SheetMeta, error) {
	xlsx, err := excelize.OpenFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("open workbook: %w", err)
	}
	defer func() { _ = xlsx.Close() }()

	sheetNames := xlsx.GetSheetList()
	result := make(map[string]models.SheetMeta, len(sheetNames))
	for index, sheetName := range sheetNames {
		maxRow, maxCol := sheetBounds(xlsx, sheetName)
		result[sheetName] = models.SheetMeta{
			Name:   sheetName,
			Index:  index,
			MaxRow: maxRow,
			MaxCol: maxCol,
		}
	}
	return result, nil
}

func sheetBounds(xlsx *excelize.File, sheetName string) (int, int) {
	dimension, err := xlsx.GetSheetDimension(sheetName)
	if err != nil || dimension == "" {
		return 0, 0
	}

	parts := strings.Split(strings.ToUpper(dimension), ":")
	lastCell := parts[len(parts)-1]
	col, row, err := excelize.CellNameToCoordinates(lastCell)
	if err != nil {
		return 0, 0
	}
	return row, col
}
