package storage

import (
	"errors"
	"math"
	"sort"
	"strconv"
	"strings"
)

const formulaErrorDisplay = "#ERROR!"

var errUnsupportedFormula = errors.New("unsupported formula")

type formulaRange struct {
	rowStart int
	rowEnd   int
	colStart int
	colEnd   int
}

type formulaEvalResult struct {
	value string
	err   error
}

type formulaEvaluator struct {
	cells    map[string]storedCell
	memo     map[string]formulaEvalResult
	visiting map[string]bool
}

func parseFormulaInput(input string) (string, bool) {
	if !strings.HasPrefix(input, "=") {
		return "", false
	}
	formula := strings.TrimSpace(strings.TrimPrefix(input, "="))
	if formula == "" {
		return "", false
	}
	return formula, true
}

func applyInputToStoredCell(current storedCell, input string) storedCell {
	if formula, ok := parseFormulaInput(input); ok {
		current.value = ""
		current.display = ""
		current.formula = formula
		current.cellType = "formula"
		return current
	}

	current.value = input
	current.display = input
	current.formula = ""
	current.cellType = detectCellType(input)
	return current
}

func buildRecalculatedCells(existing []storedCell, updates []storedCell) []storedCell {
	cellMap := make(map[string]storedCell, len(existing)+len(updates))
	for _, cell := range existing {
		cellMap[cellKey(cell.row, cell.col)] = cell
	}
	for _, cell := range updates {
		cellMap[cellKey(cell.row, cell.col)] = cell
	}

	allCells := make([]storedCell, 0, len(cellMap))
	for _, cell := range cellMap {
		allCells = append(allCells, cell)
	}

	cellsToPersist := make([]storedCell, 0, len(updates)+len(allCells))
	cellsToPersist = append(cellsToPersist, updates...)
	cellsToPersist = append(cellsToPersist, recalculateFormulaCells(allCells)...)
	return uniqueStoredCells(cellsToPersist)
}

func recalculateFormulaCells(cells []storedCell) []storedCell {
	evaluator := newFormulaEvaluator(cells)
	recalculated := make([]storedCell, 0)
	for _, cell := range cells {
		if cell.formula == "" {
			continue
		}

		next := cell
		result := evaluator.evaluateCell(cell.row, cell.col)
		switch {
		case result.err == nil:
			next.value = result.value
			next.display = result.value
		case errors.Is(result.err, errUnsupportedFormula) &&
			(strings.TrimSpace(next.value) != "" || strings.TrimSpace(next.display) != ""):
			// Preserve imported formulas we don't understand yet.
		default:
			next.value = ""
			next.display = formulaErrorDisplay
		}
		next.cellType = "formula"
		recalculated = append(recalculated, next)
	}
	return recalculated
}

func newFormulaEvaluator(cells []storedCell) *formulaEvaluator {
	cellMap := make(map[string]storedCell, len(cells))
	for _, cell := range cells {
		cellMap[cellKey(cell.row, cell.col)] = cell
	}
	return &formulaEvaluator{
		cells:    cellMap,
		memo:     make(map[string]formulaEvalResult, len(cells)),
		visiting: make(map[string]bool, len(cells)),
	}
}

func (e *formulaEvaluator) evaluateCell(row, col int) formulaEvalResult {
	return e.evaluateCellByKey(cellKey(row, col))
}

func (e *formulaEvaluator) evaluateCellByKey(key string) formulaEvalResult {
	if result, ok := e.memo[key]; ok {
		return result
	}

	cell, ok := e.cells[key]
	if !ok {
		result := formulaEvalResult{value: ""}
		e.memo[key] = result
		return result
	}
	if cell.formula == "" {
		result := formulaEvalResult{value: cell.value}
		e.memo[key] = result
		return result
	}
	if e.visiting[key] {
		result := formulaEvalResult{err: errors.New("formula cycle")}
		e.memo[key] = result
		return result
	}

	e.visiting[key] = true
	defer delete(e.visiting, key)

	ranges, err := parseFormulaRanges(cell.formula)
	if err != nil {
		result := formulaEvalResult{err: err}
		e.memo[key] = result
		return result
	}

	total := 0.0
	for _, cellRange := range ranges {
		rangeSum, sumErr := e.sumRange(cellRange)
		if sumErr != nil {
			result := formulaEvalResult{err: sumErr}
			e.memo[key] = result
			return result
		}
		total += rangeSum
	}

	result := formulaEvalResult{value: formatFormulaNumber(total)}
	e.memo[key] = result
	return result
}

func (e *formulaEvaluator) sumRange(cellRange formulaRange) (float64, error) {
	total := 0.0
	for row := cellRange.rowStart; row <= cellRange.rowEnd; row += 1 {
		for col := cellRange.colStart; col <= cellRange.colEnd; col += 1 {
			value, err := e.numericValueAt(row, col)
			if err != nil {
				return 0, err
			}
			total += value
		}
	}
	return total, nil
}

func (e *formulaEvaluator) numericValueAt(row, col int) (float64, error) {
	key := cellKey(row, col)
	cell, ok := e.cells[key]
	if !ok {
		return 0, nil
	}
	if cell.formula != "" {
		result := e.evaluateCellByKey(key)
		if result.err != nil {
			return 0, result.err
		}
		return parseNumericCellValue(result.value), nil
	}
	return parseNumericCellValue(cell.value), nil
}

func parseFormulaRanges(formula string) ([]formulaRange, error) {
	trimmed := strings.TrimSpace(formula)
	if len(trimmed) < len("SUM()") || !strings.EqualFold(trimmed[:4], "SUM(") || trimmed[len(trimmed)-1] != ')' {
		return nil, errUnsupportedFormula
	}

	body := strings.TrimSpace(trimmed[4 : len(trimmed)-1])
	if body == "" {
		return nil, errUnsupportedFormula
	}

	parts := strings.Split(body, ",")
	ranges := make([]formulaRange, 0, len(parts))
	for _, part := range parts {
		cellRange, err := parseFormulaRange(strings.TrimSpace(part))
		if err != nil {
			return nil, err
		}
		ranges = append(ranges, cellRange)
	}
	return ranges, nil
}

func parseFormulaRange(raw string) (formulaRange, error) {
	if raw == "" {
		return formulaRange{}, errUnsupportedFormula
	}

	parts := strings.Split(raw, ":")
	if len(parts) > 2 {
		return formulaRange{}, errUnsupportedFormula
	}

	startRow, startCol, err := parseCellReference(parts[0])
	if err != nil {
		return formulaRange{}, err
	}
	endRow, endCol := startRow, startCol
	if len(parts) == 2 {
		endRow, endCol, err = parseCellReference(parts[1])
		if err != nil {
			return formulaRange{}, err
		}
	}

	return formulaRange{
		rowStart: min(startRow, endRow),
		rowEnd:   max(startRow, endRow),
		colStart: min(startCol, endCol),
		colEnd:   max(startCol, endCol),
	}, nil
}

func parseCellReference(raw string) (int, int, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return 0, 0, errUnsupportedFormula
	}

	lettersEnd := 0
	for lettersEnd < len(trimmed) {
		ch := trimmed[lettersEnd]
		if (ch < 'A' || ch > 'Z') && (ch < 'a' || ch > 'z') {
			break
		}
		lettersEnd += 1
	}
	if lettersEnd == 0 || lettersEnd == len(trimmed) {
		return 0, 0, errUnsupportedFormula
	}

	col := toColumnNumber(trimmed[:lettersEnd])
	row, err := strconv.Atoi(trimmed[lettersEnd:])
	if err != nil || row < 1 || col < 1 {
		return 0, 0, errUnsupportedFormula
	}
	return row, col, nil
}

func parseNumericCellValue(value string) float64 {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0
	}
	parsed, err := strconv.ParseFloat(trimmed, 64)
	if err != nil {
		return 0
	}
	return parsed
}

func formatFormulaNumber(value float64) string {
	rounded := math.Round(value*1_000_000_000_000) / 1_000_000_000_000
	if math.Abs(rounded) < 1e-12 {
		rounded = 0
	}
	return strconv.FormatFloat(rounded, 'f', -1, 64)
}

func uniqueStoredCells(cells []storedCell) []storedCell {
	byKey := make(map[string]storedCell, len(cells))
	for _, cell := range cells {
		byKey[cellKey(cell.row, cell.col)] = cell
	}

	unique := make([]storedCell, 0, len(byKey))
	for _, cell := range byKey {
		unique = append(unique, cell)
	}
	sortStoredCells(unique)
	return unique
}

func sortStoredCells(cells []storedCell) {
	sort.Slice(cells, func(i, j int) bool {
		if cells[i].row == cells[j].row {
			return cells[i].col < cells[j].col
		}
		return cells[i].row < cells[j].row
	})
}

func toColumnNumber(label string) int {
	value := 0
	for _, char := range strings.ToUpper(label) {
		if char < 'A' || char > 'Z' {
			return 0
		}
		value = value*26 + int(char-'A'+1)
	}
	return value
}
