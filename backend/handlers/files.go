package handlers

import (
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/xuri/excelize/v2"

	"rowful/cache"
	"rowful/models"
	"rowful/parser"
	"rowful/storage"
)

type FilesHandler struct {
	cache   *cache.Store
	storage *storage.Store
}

type renameFileRequest struct {
	Name string `json:"name"`
}

type updateFileSettingsRequest struct {
	Settings models.FileSettings `json:"settings"`
}

type createFileRequest struct {
	Name string `json:"name"`
}

func NewFilesHandler(cacheStore *cache.Store, storageStore *storage.Store) FilesHandler {
	initEmailDispatcher()
	return FilesHandler{cache: cacheStore, storage: storageStore}
}

func (h FilesHandler) Create(w http.ResponseWriter, r *http.Request) {
	user, ok := CurrentUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
		return
	}

	var req createFileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err != io.EOF {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return
	}

	fileName := strings.TrimSpace(req.Name)
	if fileName == "" {
		fileName = "Untitled"
	}
	if !strings.HasSuffix(strings.ToLower(fileName), ".xlsx") {
		fileName += ".xlsx"
	}

	xlsx := excelize.NewFile()
	buffer, err := xlsx.WriteToBuffer()
	_ = xlsx.Close()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to initialize workbook"})
		return
	}

	id := uuid.NewString()
	rawHash := sha256.Sum256([]byte(id))
	fileHash := storage.ScopeFileHash(user.ID, hex.EncodeToString(rawHash[:]))
	fileBytes := buffer.Bytes()

	sheets, err := parser.ParseWorkbook(fileBytes)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to initialize workbook"})
		return
	}

	workbookMeta := cache.BuildWorkbookMeta(id, fileName, fileHash, sheets)
	if err := h.storage.SaveWorkbook(user.ID, workbookMeta, sheets, ""); err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to persist workbook"})
		return
	}

	h.cache.Put(cache.CachedWorkbook{Workbook: workbookMeta})
	sheet, err := h.storage.GetSheetWindow(workbookMeta.ID, workbookMeta.ActiveSheet, 1, defaultInitialRowCount, 1, defaultInitialColCount)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load workbook"})
		return
	}
	regions, regionsErr := h.storage.GetKanbanRegions(workbookMeta.ID)
	if regionsErr != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load kanban regions"})
		return
	}
	writeJSON(w, http.StatusOK, models.UploadResponse{Workbook: workbookMeta, Sheet: sheet, KanbanRegions: regions})
}

func (h FilesHandler) List(w http.ResponseWriter, r *http.Request) {
	user, ok := CurrentUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
		return
	}

	files, err := h.storage.ListFilesForUser(user.ID, 0)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to list files"})
		return
	}
	writeJSON(w, http.StatusOK, models.FilesResponse{Files: files})
}

func (h FilesHandler) Recent(w http.ResponseWriter, r *http.Request) {
	user, ok := CurrentUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
		return
	}

	limit := 10
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}

	files, err := h.storage.ListRecentFilesForUser(user.ID, limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to list recent files"})
		return
	}
	writeJSON(w, http.StatusOK, models.FilesResponse{Files: files})
}

func (h FilesHandler) Open(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing file id"})
		return
	}

	if _, err := requireWorkbookAccess(r, h.storage, id); err != nil {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "file not found"})
		return
	}

	workbook, sheets, ok := h.refreshWorkbook(r, id)
	if !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "file not found"})
		return
	}
	if err := h.storage.TouchWorkbookOpened(id); err == nil {
		workbook, sheets, _ = h.refreshWorkbook(r, id)
	}

	sheetName := workbook.ActiveSheet
	if _, exists := sheets[sheetName]; !exists {
		sheetName = fallbackSheet(sheets).Name
	}
	window := parseWindowRequest(r)
	sheet, err := h.storage.GetSheetWindow(id, sheetName, window.rowStart, window.rowCount, window.colStart, window.colCount)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load sheet"})
		return
	}
	regions, regionsErr := h.storage.GetKanbanRegions(id)
	if regionsErr != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load kanban regions"})
		return
	}
	writeJSON(w, http.StatusOK, models.SheetResponse{Workbook: workbook, Sheet: sheet, KanbanRegions: regions})
}

func (h FilesHandler) Rename(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing file id"})
		return
	}
	if _, err := requireWorkbookAccess(r, h.storage, id); err != nil {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "file not found"})
		return
	}

	var req renameFileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "file name is required"})
		return
	}

	if err := h.storage.RenameWorkbook(id, req.Name); err != nil {
		if err == storage.ErrNotFound {
			writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "file not found"})
			return
		}
		if err == storage.ErrInvalid {
			writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid file name"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to rename file"})
		return
	}

	h.cache.DeleteByID(id)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h FilesHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing file id"})
		return
	}
	if _, err := requireWorkbookAccess(r, h.storage, id); err != nil {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "file not found"})
		return
	}

	_, err := h.storage.DeleteWorkbook(id)
	if err != nil {
		if err == storage.ErrNotFound {
			writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "file not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to delete file"})
		return
	}

	h.cache.DeleteByID(id)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h FilesHandler) Download(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing file id"})
		return
	}
	user, ok := CurrentUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
		return
	}

	workbook, sheets, err := h.storage.GetWorkbookByIDForUser(user.ID, id)
	if err != nil {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "file not found"})
		return
	}

	format := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format")))
	switch format {
	case "csv":
		h.downloadCSV(w, workbook, sheets, r.URL.Query().Get("sheet"))
	case "xlsx":
		h.downloadXLSX(w, workbook)
	default:
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "format must be xlsx or csv"})
	}
}

func (h FilesHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing file id"})
		return
	}
	if _, err := requireWorkbookAccess(r, h.storage, id); err != nil {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "file not found"})
		return
	}

	settings, err := h.storage.GetFileSettings(id)
	if err != nil {
		if err == storage.ErrNotFound {
			writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "file not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load file settings"})
		return
	}
	writeJSON(w, http.StatusOK, models.FileSettingsResponse{Settings: settings})
}

func (h FilesHandler) downloadCSV(
	w http.ResponseWriter,
	workbook models.Workbook,
	sheets map[string]models.Sheet,
	requestedSheet string,
) {
	sheetName := strings.TrimSpace(requestedSheet)
	if sheetName == "" {
		sheetName = workbook.ActiveSheet
	}
	if _, exists := sheets[sheetName]; !exists {
		if len(workbook.Sheets) == 0 {
			writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "workbook has no sheets"})
			return
		}
		sheetName = workbook.Sheets[0].Name
	}

	sheet, err := h.storage.GetSheet(workbook.ID, sheetName)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load sheet for csv export"})
		return
	}

	fileName := buildDownloadName(workbook.FileName, sheetName, "csv")
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+fileName+`"`)

	writer := csv.NewWriter(w)
	for rowIndex := 1; rowIndex <= max(1, sheet.MaxRow); rowIndex++ {
		record := make([]string, max(1, sheet.MaxCol))
		for _, row := range sheet.Rows {
			if row.Index != rowIndex {
				continue
			}
			for _, cell := range row.Cells {
				if cell.Col < 1 || cell.Col > len(record) {
					continue
				}
				if cell.Display != "" {
					record[cell.Col-1] = cell.Display
					continue
				}
				record[cell.Col-1] = cell.Value
			}
			break
		}
		if err := writer.Write(record); err != nil {
			return
		}
	}
	writer.Flush()
}

func (h FilesHandler) downloadXLSX(w http.ResponseWriter, workbook models.Workbook) {
	if len(workbook.Sheets) == 0 {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "workbook has no sheets"})
		return
	}

	xlsx := excelize.NewFile()
	defaultSheet := xlsx.GetSheetName(0)

	for index, meta := range workbook.Sheets {
		sheet, err := h.storage.GetSheet(workbook.ID, meta.Name)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load workbook for xlsx export"})
			_ = xlsx.Close()
			return
		}

		if index == 0 {
			if meta.Name != defaultSheet {
				xlsx.SetSheetName(defaultSheet, meta.Name)
			}
		} else {
			xlsx.NewSheet(meta.Name)
		}

		for _, row := range sheet.Rows {
			for _, cell := range row.Cells {
				cellRef, coordErr := excelize.CoordinatesToCellName(cell.Col, cell.Row)
				if coordErr != nil {
					continue
				}
				if cell.Formula != "" {
					if err := xlsx.SetCellFormula(meta.Name, cellRef, cell.Formula); err != nil {
						writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to write xlsx formula"})
						_ = xlsx.Close()
						return
					}
					continue
				}
				if err := setExcelCellValue(xlsx, meta.Name, cellRef, cell); err != nil {
					writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to write xlsx cell"})
					_ = xlsx.Close()
					return
				}
			}
		}
	}

	activeIndex := 0
	for index, meta := range workbook.Sheets {
		if meta.Name == workbook.ActiveSheet {
			activeIndex = index
			break
		}
	}
	xlsx.SetActiveSheet(activeIndex)

	buffer, err := xlsx.WriteToBuffer()
	_ = xlsx.Close()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to build xlsx download"})
		return
	}

	fileName := buildDownloadName(workbook.FileName, "", "xlsx")
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", `attachment; filename="`+fileName+`"`)
	_, _ = w.Write(buffer.Bytes())
}

func setExcelCellValue(file *excelize.File, sheetName, cellRef string, cell models.Cell) error {
	switch cell.Type {
	case "boolean":
		lower := strings.ToLower(strings.TrimSpace(cell.Value))
		return file.SetCellValue(sheetName, cellRef, lower == "true")
	case "number", "formatted":
		if value, err := strconv.ParseInt(cell.Value, 10, 64); err == nil {
			return file.SetCellValue(sheetName, cellRef, value)
		}
		if value, err := strconv.ParseFloat(cell.Value, 64); err == nil {
			return file.SetCellValue(sheetName, cellRef, value)
		}
		return file.SetCellValue(sheetName, cellRef, cell.Value)
	default:
		return file.SetCellValue(sheetName, cellRef, cell.Value)
	}
}

func buildDownloadName(fileName, sheetName, ext string) string {
	base := strings.TrimSpace(fileName)
	if base == "" {
		base = "Untitled.xlsx"
	}
	base = strings.TrimSuffix(base, filepath.Ext(base))
	if sheetName != "" {
		base += "-" + strings.ReplaceAll(sheetName, "/", "-")
	}
	return base + "." + ext
}

func (h FilesHandler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing file id"})
		return
	}
	user, err := requireWorkbookAccess(r, h.storage, id)
	if err != nil {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "file not found"})
		return
	}

	var req updateFileSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return
	}

	settings, err := h.storage.UpdateFileSettings(user.ID, id, req.Settings)
	if err != nil {
		if err == storage.ErrNotFound {
			writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "file not found"})
			return
		}
		if err == storage.ErrInvalid {
			writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid email profile"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to update file settings"})
		return
	}
	writeJSON(w, http.StatusOK, models.FileSettingsResponse{Settings: settings})
}

func (h FilesHandler) refreshWorkbook(r *http.Request, id string) (models.Workbook, map[string]models.Sheet, bool) {
	user, ok := CurrentUser(r)
	if !ok {
		return models.Workbook{}, nil, false
	}
	workbook, sheets, err := h.storage.GetWorkbookByIDForUser(user.ID, id)
	if err != nil {
		return models.Workbook{}, nil, false
	}
	h.cache.Put(cache.CachedWorkbook{Workbook: workbook})
	return workbook, sheets, true
}
