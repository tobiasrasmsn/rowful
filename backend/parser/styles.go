package parser

import (
	"fmt"

	"github.com/xuri/excelize/v2"

	"planar/models"
)

type styleResolver struct {
	file  *excelize.File
	cache map[int]models.CellStyle
}

func newStyleResolver(file *excelize.File) *styleResolver {
	return &styleResolver{file: file, cache: make(map[int]models.CellStyle)}
}

func (s *styleResolver) Resolve(sheetName, cell string) *models.CellStyle {
	styleID, err := s.file.GetCellStyle(sheetName, cell)
	if err != nil || styleID == 0 {
		return nil
	}

	if cached, ok := s.cache[styleID]; ok {
		if cached == (models.CellStyle{}) {
			return nil
		}
		copy := cached
		return &copy
	}

	style, err := s.file.GetStyle(styleID)
	if err != nil || style == nil {
		return nil
	}

	resolved := models.CellStyle{}

	if style.Font != nil {
		resolved.FontFamily = style.Font.Family
		resolved.FontSize = int(style.Font.Size)
		resolved.Bold = style.Font.Bold
		resolved.Italic = style.Font.Italic
		resolved.Underline = style.Font.Underline != ""
		resolved.FontColor = normalizeColor(style.Font.Color)
	}

	if style.Fill.Type != "" && len(style.Fill.Color) > 0 {
		resolved.FillColor = normalizeColor(style.Fill.Color[0])
	}

	if style.Alignment != nil {
		resolved.HAlign = style.Alignment.Horizontal
		resolved.VAlign = style.Alignment.Vertical
		resolved.WrapText = style.Alignment.WrapText
	}

	if style.CustomNumFmt != nil {
		resolved.NumFmt = *style.CustomNumFmt
	} else if style.NumFmt != 0 {
		resolved.NumFmt = fmt.Sprintf("%d", style.NumFmt)
	}

	s.cache[styleID] = resolved
	if resolved == (models.CellStyle{}) {
		return nil
	}
	copy := resolved
	return &copy
}

func normalizeColor(color string) string {
	if color == "" {
		return ""
	}
	if color[0] == '#' {
		return color
	}
	return "#" + color
}
