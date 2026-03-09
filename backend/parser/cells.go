package parser

import (
	"strconv"
	"strings"
)

func detectCellType(rawValue, displayValue, formula string) string {
	if formula != "" {
		return "formula"
	}

	value := strings.TrimSpace(rawValue)
	if value == "" {
		return "blank"
	}

	lower := strings.ToLower(value)
	if lower == "true" || lower == "false" {
		return "boolean"
	}

	if _, err := strconv.ParseInt(value, 10, 64); err == nil {
		return "number"
	}

	if _, err := strconv.ParseFloat(value, 64); err == nil {
		return "number"
	}

	if displayValue != "" && displayValue != rawValue {
		return "formatted"
	}

	return "string"
}
