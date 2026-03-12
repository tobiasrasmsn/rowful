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

type formulaValueKind string

const (
	formulaBlankKind   formulaValueKind = "blank"
	formulaNumberKind  formulaValueKind = "number"
	formulaStringKind  formulaValueKind = "string"
	formulaBooleanKind formulaValueKind = "boolean"
)

type formulaValue struct {
	kind formulaValueKind
	num  float64
	text string
	bool bool
}

type formulaEvaluator struct {
	cells    map[string]storedCell
	memo     map[string]formulaEvalResult
	visiting map[string]bool
}

type formulaExpr interface {
	isFormulaExpr()
}

type formulaLiteralExpr struct {
	value formulaValue
}

type formulaRefExpr struct {
	row int
	col int
}

type formulaRangeExpr struct {
	start formulaRefExpr
	end   formulaRefExpr
}

type formulaFuncExpr struct {
	name string
	args []formulaExpr
}

type formulaCompareExpr struct {
	left  formulaExpr
	right formulaExpr
	op    string
}

type formulaUnaryExpr struct {
	op   string
	expr formulaExpr
}

type formulaRangeValues struct {
	values []formulaValue
	rows   int
	cols   int
}

type formulaTokenKind string

const (
	formulaTokenEOF      formulaTokenKind = "eof"
	formulaTokenWord     formulaTokenKind = "word"
	formulaTokenNumber   formulaTokenKind = "number"
	formulaTokenString   formulaTokenKind = "string"
	formulaTokenComma    formulaTokenKind = "comma"
	formulaTokenLParen   formulaTokenKind = "lparen"
	formulaTokenRParen   formulaTokenKind = "rparen"
	formulaTokenColon    formulaTokenKind = "colon"
	formulaTokenOperator formulaTokenKind = "operator"
	formulaTokenPlus     formulaTokenKind = "plus"
	formulaTokenMinus    formulaTokenKind = "minus"
)

type formulaToken struct {
	kind  formulaTokenKind
	value string
}

type formulaParser struct {
	tokens []formulaToken
	index  int
}

func (formulaLiteralExpr) isFormulaExpr() {}
func (formulaRefExpr) isFormulaExpr()     {}
func (formulaRangeExpr) isFormulaExpr()   {}
func (formulaFuncExpr) isFormulaExpr()    {}
func (formulaCompareExpr) isFormulaExpr() {}
func (formulaUnaryExpr) isFormulaExpr()   {}

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
		result := formulaEvalResult{value: formulaValueFromCell(cell).stringValue()}
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

	expr, err := parseFormulaExpr(cell.formula)
	if err != nil {
		result := formulaEvalResult{err: err}
		e.memo[key] = result
		return result
	}

	value, err := e.evaluateExpr(expr)
	if err != nil {
		result := formulaEvalResult{err: err}
		e.memo[key] = result
		return result
	}

	result := formulaEvalResult{value: value.stringValue()}
	e.memo[key] = result
	return result
}

func (e *formulaEvaluator) evaluateExpr(expr formulaExpr) (formulaValue, error) {
	switch node := expr.(type) {
	case formulaLiteralExpr:
		return node.value, nil
	case formulaRefExpr:
		return e.valueAt(node.row, node.col)
	case formulaRangeExpr:
		return formulaBlankValue(), errUnsupportedFormula
	case formulaFuncExpr:
		return e.evaluateFunction(node)
	case formulaCompareExpr:
		left, err := e.evaluateExpr(node.left)
		if err != nil {
			return formulaBlankValue(), err
		}
		right, err := e.evaluateExpr(node.right)
		if err != nil {
			return formulaBlankValue(), err
		}
		ok, err := compareFormulaValues(left, right, node.op)
		if err != nil {
			return formulaBlankValue(), err
		}
		return formulaBooleanValue(ok), nil
	case formulaUnaryExpr:
		value, err := e.evaluateExpr(node.expr)
		if err != nil {
			return formulaBlankValue(), err
		}
		number, ok := value.numberValue()
		if !ok {
			return formulaBlankValue(), errUnsupportedFormula
		}
		if node.op == "-" {
			number = -number
		}
		return formulaNumberValue(number), nil
	default:
		return formulaBlankValue(), errUnsupportedFormula
	}
}

func (e *formulaEvaluator) evaluateFunction(node formulaFuncExpr) (formulaValue, error) {
	switch strings.ToUpper(node.name) {
	case "SUM":
		return e.aggregateNumeric(node.args, "sum")
	case "AVERAGE":
		return e.aggregateNumeric(node.args, "average")
	case "MIN":
		return e.aggregateNumeric(node.args, "min")
	case "MAX":
		return e.aggregateNumeric(node.args, "max")
	case "COUNT":
		values, err := e.flattenValues(node.args)
		if err != nil {
			return formulaBlankValue(), err
		}
		count := 0
		for _, value := range values {
			if _, ok := value.numberValue(); ok {
				count += 1
			}
		}
		return formulaNumberValue(float64(count)), nil
	case "COUNTA":
		values, err := e.flattenValues(node.args)
		if err != nil {
			return formulaBlankValue(), err
		}
		count := 0
		for _, value := range values {
			if !value.isBlank() {
				count += 1
			}
		}
		return formulaNumberValue(float64(count)), nil
	case "IF":
		if len(node.args) != 3 {
			return formulaBlankValue(), errUnsupportedFormula
		}
		condition, err := e.evaluateExpr(node.args[0])
		if err != nil {
			return formulaBlankValue(), err
		}
		if condition.truthy() {
			return e.evaluateExpr(node.args[1])
		}
		return e.evaluateExpr(node.args[2])
	case "ROUND":
		if len(node.args) != 2 {
			return formulaBlankValue(), errUnsupportedFormula
		}
		value, err := e.evaluateExpr(node.args[0])
		if err != nil {
			return formulaBlankValue(), err
		}
		number, ok := value.numberValue()
		if !ok {
			return formulaBlankValue(), errUnsupportedFormula
		}
		digitsValue, err := e.evaluateExpr(node.args[1])
		if err != nil {
			return formulaBlankValue(), err
		}
		digitsNumber, ok := digitsValue.numberValue()
		if !ok {
			return formulaBlankValue(), errUnsupportedFormula
		}
		digits := int(math.Round(digitsNumber))
		factor := math.Pow(10, float64(digits))
		if digits >= 0 {
			return formulaNumberValue(math.Round(number*factor) / factor), nil
		}
		factor = math.Pow(10, float64(-digits))
		return formulaNumberValue(math.Round(number/factor) * factor), nil
	case "ABS":
		if len(node.args) != 1 {
			return formulaBlankValue(), errUnsupportedFormula
		}
		value, err := e.evaluateExpr(node.args[0])
		if err != nil {
			return formulaBlankValue(), err
		}
		number, ok := value.numberValue()
		if !ok {
			return formulaBlankValue(), errUnsupportedFormula
		}
		return formulaNumberValue(math.Abs(number)), nil
	case "LEN":
		if len(node.args) != 1 {
			return formulaBlankValue(), errUnsupportedFormula
		}
		value, err := e.evaluateExpr(node.args[0])
		if err != nil {
			return formulaBlankValue(), err
		}
		return formulaNumberValue(float64(len(value.textValue()))), nil
	case "SUMIF":
		return e.evaluateConditionalAggregate(node.args, "sum")
	case "AVERAGEIF":
		return e.evaluateConditionalAggregate(node.args, "average")
	case "INDEX":
		return e.evaluateIndex(node.args)
	case "MATCH":
		return e.evaluateMatch(node.args)
	default:
		return formulaBlankValue(), errUnsupportedFormula
	}
}

func (e *formulaEvaluator) aggregateNumeric(args []formulaExpr, mode string) (formulaValue, error) {
	values, err := e.flattenValues(args)
	if err != nil {
		return formulaBlankValue(), err
	}

	var total float64
	var count int
	var minimum float64
	var maximum float64
	for _, value := range values {
		number, ok := value.numberValue()
		if !ok {
			continue
		}
		if count == 0 {
			minimum = number
			maximum = number
		}
		total += number
		count += 1
		minimum = math.Min(minimum, number)
		maximum = math.Max(maximum, number)
	}

	switch mode {
	case "sum":
		return formulaNumberValue(total), nil
	case "average":
		if count == 0 {
			return formulaBlankValue(), errors.New("division by zero")
		}
		return formulaNumberValue(total / float64(count)), nil
	case "min":
		if count == 0 {
			return formulaBlankValue(), errUnsupportedFormula
		}
		return formulaNumberValue(minimum), nil
	case "max":
		if count == 0 {
			return formulaBlankValue(), errUnsupportedFormula
		}
		return formulaNumberValue(maximum), nil
	default:
		return formulaBlankValue(), errUnsupportedFormula
	}
}

func (e *formulaEvaluator) evaluateConditionalAggregate(args []formulaExpr, mode string) (formulaValue, error) {
	if len(args) < 2 || len(args) > 3 {
		return formulaBlankValue(), errUnsupportedFormula
	}

	criteriaRange, err := e.rangeValuesForExpr(args[0], false)
	if err != nil {
		return formulaBlankValue(), err
	}
	criteria, err := e.evaluateExpr(args[1])
	if err != nil {
		return formulaBlankValue(), err
	}

	sumRange := criteriaRange
	if len(args) == 3 {
		sumRange, err = e.rangeValuesForExpr(args[2], false)
		if err != nil {
			return formulaBlankValue(), err
		}
	}
	if criteriaRange.rows != sumRange.rows || criteriaRange.cols != sumRange.cols {
		return formulaBlankValue(), errUnsupportedFormula
	}

	total := 0.0
	count := 0
	for idx, value := range criteriaRange.values {
		if !matchesCriteria(value, criteria) {
			continue
		}
		number, ok := sumRange.values[idx].numberValue()
		if !ok {
			continue
		}
		total += number
		count += 1
	}

	if mode == "sum" {
		return formulaNumberValue(total), nil
	}
	if count == 0 {
		return formulaBlankValue(), errors.New("division by zero")
	}
	return formulaNumberValue(total / float64(count)), nil
}

func (e *formulaEvaluator) evaluateIndex(args []formulaExpr) (formulaValue, error) {
	if len(args) < 2 || len(args) > 3 {
		return formulaBlankValue(), errUnsupportedFormula
	}

	rangeValues, err := e.rangeValuesForExpr(args[0], false)
	if err != nil {
		return formulaBlankValue(), err
	}
	rowValue, err := e.evaluateExpr(args[1])
	if err != nil {
		return formulaBlankValue(), err
	}
	rowNumber, ok := rowValue.numberValue()
	if !ok {
		return formulaBlankValue(), errUnsupportedFormula
	}
	rowIndex := int(math.Round(rowNumber))
	colIndex := 1
	if len(args) == 3 {
		colValue, err := e.evaluateExpr(args[2])
		if err != nil {
			return formulaBlankValue(), err
		}
		colNumber, ok := colValue.numberValue()
		if !ok {
			return formulaBlankValue(), errUnsupportedFormula
		}
		colIndex = int(math.Round(colNumber))
	}

	if rowIndex < 1 || colIndex < 1 || rowIndex > rangeValues.rows || colIndex > rangeValues.cols {
		return formulaBlankValue(), errUnsupportedFormula
	}
	flatIndex := (rowIndex-1)*rangeValues.cols + (colIndex - 1)
	return rangeValues.values[flatIndex], nil
}

func (e *formulaEvaluator) evaluateMatch(args []formulaExpr) (formulaValue, error) {
	if len(args) < 2 || len(args) > 3 {
		return formulaBlankValue(), errUnsupportedFormula
	}

	lookup, err := e.evaluateExpr(args[0])
	if err != nil {
		return formulaBlankValue(), err
	}
	rangeValues, err := e.rangeValuesForExpr(args[1], false)
	if err != nil {
		return formulaBlankValue(), err
	}
	if rangeValues.rows != 1 && rangeValues.cols != 1 {
		return formulaBlankValue(), errUnsupportedFormula
	}
	if len(args) == 3 {
		matchTypeValue, err := e.evaluateExpr(args[2])
		if err != nil {
			return formulaBlankValue(), err
		}
		matchType, ok := matchTypeValue.numberValue()
		if !ok || int(math.Round(matchType)) != 0 {
			return formulaBlankValue(), errUnsupportedFormula
		}
	}

	for idx, value := range rangeValues.values {
		equal, err := compareFormulaValues(value, lookup, "=")
		if err != nil {
			return formulaBlankValue(), err
		}
		if equal {
			return formulaNumberValue(float64(idx + 1)), nil
		}
	}
	return formulaBlankValue(), errUnsupportedFormula
}

func (e *formulaEvaluator) flattenValues(args []formulaExpr) ([]formulaValue, error) {
	values := make([]formulaValue, 0)
	for _, arg := range args {
		rangeValues, err := e.rangeValuesForExpr(arg, true)
		if err != nil {
			return nil, err
		}
		values = append(values, rangeValues.values...)
	}
	return values, nil
}

func (e *formulaEvaluator) rangeValuesForExpr(expr formulaExpr, allowScalar bool) (formulaRangeValues, error) {
	switch node := expr.(type) {
	case formulaRangeExpr:
		return e.valuesForRange(node)
	case formulaRefExpr:
		value, err := e.valueAt(node.row, node.col)
		if err != nil {
			return formulaRangeValues{}, err
		}
		return formulaRangeValues{
			values: []formulaValue{value},
			rows:   1,
			cols:   1,
		}, nil
	default:
		if !allowScalar {
			return formulaRangeValues{}, errUnsupportedFormula
		}
		value, err := e.evaluateExpr(expr)
		if err != nil {
			return formulaRangeValues{}, err
		}
		return formulaRangeValues{
			values: []formulaValue{value},
			rows:   1,
			cols:   1,
		}, nil
	}
}

func (e *formulaEvaluator) valuesForRange(expr formulaRangeExpr) (formulaRangeValues, error) {
	cellRange := expr.normalized()
	values := make([]formulaValue, 0, (cellRange.rowEnd-cellRange.rowStart+1)*(cellRange.colEnd-cellRange.colStart+1))
	for row := cellRange.rowStart; row <= cellRange.rowEnd; row += 1 {
		for col := cellRange.colStart; col <= cellRange.colEnd; col += 1 {
			value, err := e.valueAt(row, col)
			if err != nil {
				return formulaRangeValues{}, err
			}
			values = append(values, value)
		}
	}
	return formulaRangeValues{
		values: values,
		rows:   cellRange.rowEnd - cellRange.rowStart + 1,
		cols:   cellRange.colEnd - cellRange.colStart + 1,
	}, nil
}

func (e *formulaEvaluator) valueAt(row, col int) (formulaValue, error) {
	key := cellKey(row, col)
	cell, ok := e.cells[key]
	if !ok {
		return formulaBlankValue(), nil
	}
	if cell.formula == "" {
		return formulaValueFromCell(cell), nil
	}
	result := e.evaluateCellByKey(key)
	if result.err != nil {
		return formulaBlankValue(), result.err
	}
	return formulaValueFromString(result.value), nil
}

func parseFormulaExpr(formula string) (formulaExpr, error) {
	tokens, err := tokenizeFormula(formula)
	if err != nil {
		return nil, err
	}
	parser := formulaParser{tokens: tokens}
	expr, err := parser.parseExpression()
	if err != nil {
		return nil, err
	}
	if parser.current().kind != formulaTokenEOF {
		return nil, errUnsupportedFormula
	}
	return expr, nil
}

func tokenizeFormula(formula string) ([]formulaToken, error) {
	tokens := make([]formulaToken, 0)
	for index := 0; index < len(formula); {
		char := formula[index]
		switch {
		case char == ' ' || char == '\t' || char == '\n' || char == '\r':
			index += 1
		case isFormulaLetter(char):
			start := index
			index += 1
			for index < len(formula) && (isFormulaLetter(formula[index]) || isFormulaDigit(formula[index]) || formula[index] == '_') {
				index += 1
			}
			tokens = append(tokens, formulaToken{
				kind:  formulaTokenWord,
				value: formula[start:index],
			})
		case isFormulaDigit(char) || char == '.':
			start := index
			index += 1
			for index < len(formula) && (isFormulaDigit(formula[index]) || formula[index] == '.') {
				index += 1
			}
			tokens = append(tokens, formulaToken{
				kind:  formulaTokenNumber,
				value: formula[start:index],
			})
		case char == '"':
			index += 1
			var value strings.Builder
			for index < len(formula) {
				if formula[index] == '"' {
					if index+1 < len(formula) && formula[index+1] == '"' {
						value.WriteByte('"')
						index += 2
						continue
					}
					index += 1
					break
				}
				value.WriteByte(formula[index])
				index += 1
			}
			tokens = append(tokens, formulaToken{
				kind:  formulaTokenString,
				value: value.String(),
			})
		case char == ',':
			tokens = append(tokens, formulaToken{kind: formulaTokenComma, value: ","})
			index += 1
		case char == '(':
			tokens = append(tokens, formulaToken{kind: formulaTokenLParen, value: "("})
			index += 1
		case char == ')':
			tokens = append(tokens, formulaToken{kind: formulaTokenRParen, value: ")"})
			index += 1
		case char == ':':
			tokens = append(tokens, formulaToken{kind: formulaTokenColon, value: ":"})
			index += 1
		case char == '+':
			tokens = append(tokens, formulaToken{kind: formulaTokenPlus, value: "+"})
			index += 1
		case char == '-':
			tokens = append(tokens, formulaToken{kind: formulaTokenMinus, value: "-"})
			index += 1
		case char == '>' || char == '<' || char == '=':
			start := index
			index += 1
			if index < len(formula) {
				next := formula[index]
				if (char == '>' && next == '=') || (char == '<' && (next == '=' || next == '>')) {
					index += 1
				}
			}
			tokens = append(tokens, formulaToken{
				kind:  formulaTokenOperator,
				value: formula[start:index],
			})
		default:
			return nil, errUnsupportedFormula
		}
	}
	tokens = append(tokens, formulaToken{kind: formulaTokenEOF})
	return tokens, nil
}

func (p *formulaParser) parseExpression() (formulaExpr, error) {
	return p.parseComparison()
}

func (p *formulaParser) parseComparison() (formulaExpr, error) {
	left, err := p.parseUnary()
	if err != nil {
		return nil, err
	}
	if p.current().kind != formulaTokenOperator {
		return left, nil
	}
	operator := p.current().value
	p.index += 1
	right, err := p.parseUnary()
	if err != nil {
		return nil, err
	}
	return formulaCompareExpr{
		left:  left,
		right: right,
		op:    operator,
	}, nil
}

func (p *formulaParser) parseUnary() (formulaExpr, error) {
	switch p.current().kind {
	case formulaTokenPlus:
		p.index += 1
		return p.parseUnary()
	case formulaTokenMinus:
		p.index += 1
		expr, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		return formulaUnaryExpr{op: "-", expr: expr}, nil
	default:
		return p.parseRangeOrPrimary()
	}
}

func (p *formulaParser) parseRangeOrPrimary() (formulaExpr, error) {
	expr, err := p.parsePrimary()
	if err != nil {
		return nil, err
	}
	ref, ok := expr.(formulaRefExpr)
	if !ok || p.current().kind != formulaTokenColon {
		return expr, nil
	}

	p.index += 1
	next, err := p.parsePrimary()
	if err != nil {
		return nil, err
	}
	nextRef, ok := next.(formulaRefExpr)
	if !ok {
		return nil, errUnsupportedFormula
	}
	return formulaRangeExpr{
		start: ref,
		end:   nextRef,
	}, nil
}

func (p *formulaParser) parsePrimary() (formulaExpr, error) {
	token := p.current()
	switch token.kind {
	case formulaTokenNumber:
		p.index += 1
		value, err := strconv.ParseFloat(token.value, 64)
		if err != nil {
			return nil, errUnsupportedFormula
		}
		return formulaLiteralExpr{value: formulaNumberValue(value)}, nil
	case formulaTokenString:
		p.index += 1
		return formulaLiteralExpr{value: formulaStringValue(token.value)}, nil
	case formulaTokenWord:
		p.index += 1
		if strings.EqualFold(token.value, "TRUE") {
			return formulaLiteralExpr{value: formulaBooleanValue(true)}, nil
		}
		if strings.EqualFold(token.value, "FALSE") {
			return formulaLiteralExpr{value: formulaBooleanValue(false)}, nil
		}
		if p.current().kind == formulaTokenLParen {
			p.index += 1
			args, err := p.parseFunctionArgs()
			if err != nil {
				return nil, err
			}
			return formulaFuncExpr{name: token.value, args: args}, nil
		}
		row, col, err := parseCellReference(token.value)
		if err != nil {
			return nil, errUnsupportedFormula
		}
		return formulaRefExpr{row: row, col: col}, nil
	case formulaTokenLParen:
		p.index += 1
		expr, err := p.parseExpression()
		if err != nil {
			return nil, err
		}
		if p.current().kind != formulaTokenRParen {
			return nil, errUnsupportedFormula
		}
		p.index += 1
		return expr, nil
	default:
		return nil, errUnsupportedFormula
	}
}

func (p *formulaParser) parseFunctionArgs() ([]formulaExpr, error) {
	args := make([]formulaExpr, 0)
	if p.current().kind == formulaTokenRParen {
		p.index += 1
		return args, nil
	}
	for {
		arg, err := p.parseExpression()
		if err != nil {
			return nil, err
		}
		args = append(args, arg)
		switch p.current().kind {
		case formulaTokenComma:
			p.index += 1
		case formulaTokenRParen:
			p.index += 1
			return args, nil
		default:
			return nil, errUnsupportedFormula
		}
	}
}

func (p *formulaParser) current() formulaToken {
	if p.index >= len(p.tokens) {
		return formulaToken{kind: formulaTokenEOF}
	}
	return p.tokens[p.index]
}

func (expr formulaRangeExpr) normalized() formulaRange {
	return formulaRange{
		rowStart: min(expr.start.row, expr.end.row),
		rowEnd:   max(expr.start.row, expr.end.row),
		colStart: min(expr.start.col, expr.end.col),
		colEnd:   max(expr.start.col, expr.end.col),
	}
}

func formulaBlankValue() formulaValue {
	return formulaValue{kind: formulaBlankKind}
}

func formulaNumberValue(value float64) formulaValue {
	return formulaValue{kind: formulaNumberKind, num: value}
}

func formulaStringValue(value string) formulaValue {
	return formulaValue{kind: formulaStringKind, text: value}
}

func formulaBooleanValue(value bool) formulaValue {
	return formulaValue{kind: formulaBooleanKind, bool: value}
}

func formulaValueFromCell(cell storedCell) formulaValue {
	return formulaValueFromString(cell.value)
}

func formulaValueFromString(value string) formulaValue {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return formulaBlankValue()
	}
	if strings.EqualFold(trimmed, "TRUE") {
		return formulaBooleanValue(true)
	}
	if strings.EqualFold(trimmed, "FALSE") {
		return formulaBooleanValue(false)
	}
	if number, err := strconv.ParseFloat(trimmed, 64); err == nil {
		return formulaNumberValue(number)
	}
	return formulaStringValue(value)
}

func (value formulaValue) isBlank() bool {
	switch value.kind {
	case formulaBlankKind:
		return true
	case formulaStringKind:
		return strings.TrimSpace(value.text) == ""
	default:
		return false
	}
}

func (value formulaValue) stringValue() string {
	switch value.kind {
	case formulaBlankKind:
		return ""
	case formulaNumberKind:
		return formatFormulaNumber(value.num)
	case formulaBooleanKind:
		if value.bool {
			return "TRUE"
		}
		return "FALSE"
	case formulaStringKind:
		return value.text
	default:
		return ""
	}
}

func (value formulaValue) textValue() string {
	return value.stringValue()
}

func (value formulaValue) truthy() bool {
	switch value.kind {
	case formulaBlankKind:
		return false
	case formulaBooleanKind:
		return value.bool
	case formulaNumberKind:
		return math.Abs(value.num) > 1e-12
	case formulaStringKind:
		return strings.TrimSpace(value.text) != ""
	default:
		return false
	}
}

func (value formulaValue) numberValue() (float64, bool) {
	switch value.kind {
	case formulaNumberKind:
		return value.num, true
	case formulaBooleanKind:
		if value.bool {
			return 1, true
		}
		return 0, true
	case formulaStringKind:
		number, err := strconv.ParseFloat(strings.TrimSpace(value.text), 64)
		if err != nil {
			return 0, false
		}
		return number, true
	default:
		return 0, false
	}
}

func compareFormulaValues(left, right formulaValue, operator string) (bool, error) {
	if leftNumber, leftOK := left.numberValue(); leftOK {
		if rightNumber, rightOK := right.numberValue(); rightOK {
			switch operator {
			case "=":
				return math.Abs(leftNumber-rightNumber) < 1e-9, nil
			case "<>":
				return math.Abs(leftNumber-rightNumber) >= 1e-9, nil
			case ">":
				return leftNumber > rightNumber, nil
			case ">=":
				return leftNumber >= rightNumber, nil
			case "<":
				return leftNumber < rightNumber, nil
			case "<=":
				return leftNumber <= rightNumber, nil
			default:
				return false, errUnsupportedFormula
			}
		}
	}

	leftText := strings.ToLower(left.textValue())
	rightText := strings.ToLower(right.textValue())
	switch operator {
	case "=":
		return leftText == rightText, nil
	case "<>":
		return leftText != rightText, nil
	case ">":
		return leftText > rightText, nil
	case ">=":
		return leftText >= rightText, nil
	case "<":
		return leftText < rightText, nil
	case "<=":
		return leftText <= rightText, nil
	default:
		return false, errUnsupportedFormula
	}
}

func matchesCriteria(cellValue, criteria formulaValue) bool {
	if criteria.kind != formulaStringKind {
		ok, err := compareFormulaValues(cellValue, criteria, "=")
		return err == nil && ok
	}

	criterion := strings.TrimSpace(criteria.text)
	for _, operator := range []string{">=", "<=", "<>", ">", "<", "="} {
		if strings.HasPrefix(criterion, operator) {
			target := formulaValueFromString(strings.TrimSpace(strings.TrimPrefix(criterion, operator)))
			ok, err := compareFormulaValues(cellValue, target, operator)
			return err == nil && ok
		}
	}

	ok, err := compareFormulaValues(cellValue, formulaValueFromString(criterion), "=")
	return err == nil && ok
}

func parseCellReference(raw string) (int, int, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return 0, 0, errUnsupportedFormula
	}

	lettersEnd := 0
	for lettersEnd < len(trimmed) {
		char := trimmed[lettersEnd]
		if !isFormulaLetter(char) {
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

func isFormulaLetter(char byte) bool {
	return (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z')
}

func isFormulaDigit(char byte) bool {
	return char >= '0' && char <= '9'
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
