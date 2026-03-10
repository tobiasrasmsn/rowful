package handlers

import (
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"planar/cache"
	"planar/models"
	"planar/storage"
)

const (
	defaultInitialRowCount = 200
	defaultInitialColCount = 60
)

type SheetHandler struct {
	cache   *cache.Store
	storage *storage.Store
}

type cellWindowRequest struct {
	rowStart int
	rowCount int
	colStart int
	colCount int
}

type selectionTarget struct {
	Mode  string            `json:"mode"`
	Row   int               `json:"row,omitempty"`
	Col   int               `json:"col,omitempty"`
	Range *models.CellRange `json:"range,omitempty"`
}

type updateCellRequest struct {
	Sheet string `json:"sheet"`
	Row   int    `json:"row"`
	Col   int    `json:"col"`
	Value string `json:"value"`
}

type saveSheetRequest struct {
	Sheet models.Sheet `json:"sheet"`
}

type stylePatchRequest struct {
	Sheet  string                `json:"sheet"`
	Target selectionTarget       `json:"target"`
	Patch  models.CellStylePatch `json:"patch"`
}

type clearRangeRequest struct {
	Sheet  string          `json:"sheet"`
	Target selectionTarget `json:"target"`
}

type createSheetRequest struct {
	Name string `json:"name"`
}

type renameSheetRequest struct {
	OldName string `json:"oldName"`
	NewName string `json:"newName"`
}

type deleteSheetRequest struct {
	Name string `json:"name"`
}

type resizeSheetRequest struct {
	Sheet   string `json:"sheet"`
	AddRows int    `json:"addRows"`
	AddCols int    `json:"addCols"`
}

type deleteAxisRequest struct {
	Sheet string `json:"sheet"`
	Start int    `json:"start"`
	Count int    `json:"count"`
}

func NewSheetHandler(cacheStore *cache.Store, storageStore *storage.Store) SheetHandler {
	return SheetHandler{cache: cacheStore, storage: storageStore}
}

func (h SheetHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing workbook id"})
		return
	}

	workbook, _, ok := h.refreshWorkbook(r, id)
	if !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "workbook not found"})
		return
	}

	sheetName := strings.TrimSpace(r.URL.Query().Get("sheet"))
	if sheetName == "" {
		sheetName = workbook.ActiveSheet
	}
	window := parseWindowRequest(r)
	if sheetName != workbook.ActiveSheet {
		_ = h.storage.SetActiveSheet(id, sheetName)
		workbook, _, _ = h.refreshWorkbook(r, id)
	}
	sheet, err := h.storage.GetSheetWindow(id, sheetName, window.rowStart, window.rowCount, window.colStart, window.colCount)
	if err != nil {
		if err == storage.ErrNotFound {
			writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "sheet not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load sheet"})
		return
	}

	writeJSON(w, http.StatusOK, models.SheetResponse{Workbook: workbook, Sheet: sheet})
}

func (h SheetHandler) UpdateCell(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing workbook id"})
		return
	}
	if _, _, ok := h.loadWorkbook(r, id); !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "workbook not found"})
		return
	}

	var req updateCellRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return
	}
	if req.Sheet == "" || req.Row < 1 || req.Col < 1 {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "sheet, row, and col are required"})
		return
	}

	if err := h.storage.UpsertCell(id, req.Sheet, req.Row, req.Col, req.Value); err != nil {
		if err == storage.ErrNotFound {
			writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "sheet not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to persist cell update"})
		return
	}

	workbook, _, ok := h.refreshWorkbook(r, id)
	if !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "workbook not found"})
		return
	}
	sheet, err := h.storage.GetSheetWindow(id, req.Sheet, req.Row, 1, req.Col, 1)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load updated cell"})
		return
	}
	writeJSON(w, http.StatusOK, models.SheetResponse{Workbook: workbook, Sheet: sheet})
}

func (h SheetHandler) ApplyStyle(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing workbook id"})
		return
	}
	if _, _, ok := h.loadWorkbook(r, id); !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "workbook not found"})
		return
	}

	var req stylePatchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return
	}
	if strings.TrimSpace(req.Sheet) == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "sheet is required"})
		return
	}
	if err := h.storage.ApplyStylePatch(id, req.Sheet, req.Target.Mode, req.Target.Row, req.Target.Col, req.Target.Range, req.Patch); err != nil {
		h.writeStorageError(w, err, "failed to apply style")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h SheetHandler) ClearFormatting(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing workbook id"})
		return
	}
	if _, _, ok := h.loadWorkbook(r, id); !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "workbook not found"})
		return
	}

	var req clearRangeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return
	}
	if strings.TrimSpace(req.Sheet) == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "sheet is required"})
		return
	}
	if err := h.storage.ClearFormatting(id, req.Sheet, req.Target.Mode, req.Target.Row, req.Target.Col, req.Target.Range); err != nil {
		h.writeStorageError(w, err, "failed to clear formatting")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h SheetHandler) ClearValues(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing workbook id"})
		return
	}
	if _, _, ok := h.loadWorkbook(r, id); !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "workbook not found"})
		return
	}

	var req clearRangeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return
	}
	if strings.TrimSpace(req.Sheet) == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "sheet is required"})
		return
	}
	if err := h.storage.ClearValues(id, req.Sheet, req.Target.Mode, req.Target.Row, req.Target.Col, req.Target.Range); err != nil {
		h.writeStorageError(w, err, "failed to clear values")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h SheetHandler) SaveSheet(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing workbook id"})
		return
	}
	if _, _, ok := h.loadWorkbook(r, id); !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "workbook not found"})
		return
	}

	var req saveSheetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return
	}
	if strings.TrimSpace(req.Sheet.Name) == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "sheet name is required"})
		return
	}

	if err := h.storage.UpdateSheet(id, req.Sheet); err != nil {
		h.writeStorageError(w, err, "failed to save sheet")
		return
	}

	workbook, _, ok := h.refreshWorkbook(r, id)
	if !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "workbook not found"})
		return
	}
	sheet, err := h.storage.GetSheetWindow(id, req.Sheet.Name, 1, defaultInitialRowCount, 1, defaultInitialColCount)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load saved sheet"})
		return
	}
	writeJSON(w, http.StatusOK, models.SheetResponse{Workbook: workbook, Sheet: sheet})
}

func (h SheetHandler) CreateSheet(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing workbook id"})
		return
	}
	if _, _, ok := h.loadWorkbook(r, id); !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "workbook not found"})
		return
	}

	var req createSheetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "sheet name is required"})
		return
	}

	if err := h.storage.CreateSheet(id, name); err != nil {
		h.writeStorageError(w, err, "failed to create sheet")
		return
	}

	workbook, _, ok := h.refreshWorkbook(r, id)
	if !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "workbook not found"})
		return
	}
	sheet, err := h.storage.GetSheetWindow(id, name, 1, defaultInitialRowCount, 1, defaultInitialColCount)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load created sheet"})
		return
	}
	writeJSON(w, http.StatusOK, models.SheetResponse{Workbook: workbook, Sheet: sheet})
}

func (h SheetHandler) RenameSheet(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing workbook id"})
		return
	}
	if _, _, ok := h.loadWorkbook(r, id); !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "workbook not found"})
		return
	}

	var req renameSheetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return
	}
	oldName := strings.TrimSpace(req.OldName)
	newName := strings.TrimSpace(req.NewName)
	if oldName == "" || newName == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "oldName and newName are required"})
		return
	}

	if err := h.storage.RenameSheet(id, oldName, newName); err != nil {
		h.writeStorageError(w, err, "failed to rename sheet")
		return
	}

	workbook, _, ok := h.refreshWorkbook(r, id)
	if !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "workbook not found"})
		return
	}
	sheet, err := h.storage.GetSheetWindow(id, newName, 1, defaultInitialRowCount, 1, defaultInitialColCount)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load renamed sheet"})
		return
	}
	writeJSON(w, http.StatusOK, models.SheetResponse{Workbook: workbook, Sheet: sheet})
}

func (h SheetHandler) DeleteSheet(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing workbook id"})
		return
	}
	if _, _, ok := h.loadWorkbook(r, id); !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "workbook not found"})
		return
	}

	var req deleteSheetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "sheet name is required"})
		return
	}

	if err := h.storage.DeleteSheet(id, name); err != nil {
		h.writeStorageError(w, err, "failed to delete sheet")
		return
	}

	workbook, sheets, ok := h.loadWorkbook(r, id)
	if !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "workbook not found"})
		return
	}
	sheetName := workbook.ActiveSheet
	if _, exists := sheets[sheetName]; !exists {
		for _, meta := range workbook.Sheets {
			sheetName = meta.Name
			break
		}
	}
	sheet, err := h.storage.GetSheetWindow(id, sheetName, 1, defaultInitialRowCount, 1, defaultInitialColCount)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load active sheet"})
		return
	}
	writeJSON(w, http.StatusOK, models.SheetResponse{Workbook: workbook, Sheet: sheet})
}

func (h SheetHandler) ResizeSheet(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing workbook id"})
		return
	}
	if _, _, ok := h.loadWorkbook(r, id); !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "workbook not found"})
		return
	}

	var req resizeSheetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return
	}
	req.Sheet = strings.TrimSpace(req.Sheet)
	if req.Sheet == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "sheet is required"})
		return
	}
	if req.AddRows < 0 || req.AddCols < 0 || (req.AddRows == 0 && req.AddCols == 0) {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "addRows or addCols must be greater than zero"})
		return
	}

	if err := h.storage.ExpandSheet(id, req.Sheet, req.AddRows, req.AddCols); err != nil {
		h.writeStorageError(w, err, "failed to resize sheet")
		return
	}

	workbook, _, ok := h.refreshWorkbook(r, id)
	if !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "workbook not found"})
		return
	}

	window := parseWindowRequest(r)
	sheet, err := h.storage.GetSheetWindow(
		id,
		req.Sheet,
		window.rowStart,
		window.rowCount,
		window.colStart,
		window.colCount,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load resized sheet"})
		return
	}
	writeJSON(w, http.StatusOK, models.SheetResponse{Workbook: workbook, Sheet: sheet})
}

func (h SheetHandler) DeleteRows(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing workbook id"})
		return
	}
	if _, _, ok := h.loadWorkbook(r, id); !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "workbook not found"})
		return
	}
	var req deleteAxisRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return
	}
	req.Sheet = strings.TrimSpace(req.Sheet)
	if req.Sheet == "" || req.Start < 1 || req.Count < 1 {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "sheet, start, and count are required"})
		return
	}
	if err := h.storage.DeleteRows(id, req.Sheet, req.Start, req.Count); err != nil {
		h.writeStorageError(w, err, "failed to delete rows")
		return
	}
	workbook, _, ok := h.refreshWorkbook(r, id)
	if !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "workbook not found"})
		return
	}
	window := parseWindowRequest(r)
	sheet, err := h.storage.GetSheetWindow(id, req.Sheet, window.rowStart, window.rowCount, window.colStart, window.colCount)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load updated sheet"})
		return
	}
	writeJSON(w, http.StatusOK, models.SheetResponse{Workbook: workbook, Sheet: sheet})
}

func (h SheetHandler) InsertRows(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing workbook id"})
		return
	}
	if _, _, ok := h.loadWorkbook(r, id); !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "workbook not found"})
		return
	}
	var req deleteAxisRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return
	}
	req.Sheet = strings.TrimSpace(req.Sheet)
	if req.Sheet == "" || req.Start < 1 || req.Count < 1 {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "sheet, start, and count are required"})
		return
	}
	if err := h.storage.InsertRows(id, req.Sheet, req.Start, req.Count); err != nil {
		h.writeStorageError(w, err, "failed to insert rows")
		return
	}
	workbook, _, ok := h.refreshWorkbook(r, id)
	if !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "workbook not found"})
		return
	}
	window := parseWindowRequest(r)
	sheet, err := h.storage.GetSheetWindow(id, req.Sheet, window.rowStart, window.rowCount, window.colStart, window.colCount)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load updated sheet"})
		return
	}
	writeJSON(w, http.StatusOK, models.SheetResponse{Workbook: workbook, Sheet: sheet})
}

func (h SheetHandler) DeleteCols(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing workbook id"})
		return
	}
	if _, _, ok := h.loadWorkbook(r, id); !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "workbook not found"})
		return
	}
	var req deleteAxisRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return
	}
	req.Sheet = strings.TrimSpace(req.Sheet)
	if req.Sheet == "" || req.Start < 1 || req.Count < 1 {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "sheet, start, and count are required"})
		return
	}
	if err := h.storage.DeleteCols(id, req.Sheet, req.Start, req.Count); err != nil {
		h.writeStorageError(w, err, "failed to delete columns")
		return
	}
	workbook, _, ok := h.refreshWorkbook(r, id)
	if !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "workbook not found"})
		return
	}
	window := parseWindowRequest(r)
	sheet, err := h.storage.GetSheetWindow(id, req.Sheet, window.rowStart, window.rowCount, window.colStart, window.colCount)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load updated sheet"})
		return
	}
	writeJSON(w, http.StatusOK, models.SheetResponse{Workbook: workbook, Sheet: sheet})
}

func (h SheetHandler) InsertCols(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing workbook id"})
		return
	}
	if _, _, ok := h.loadWorkbook(r, id); !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "workbook not found"})
		return
	}
	var req deleteAxisRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return
	}
	req.Sheet = strings.TrimSpace(req.Sheet)
	if req.Sheet == "" || req.Start < 1 || req.Count < 1 {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "sheet, start, and count are required"})
		return
	}
	if err := h.storage.InsertCols(id, req.Sheet, req.Start, req.Count); err != nil {
		h.writeStorageError(w, err, "failed to insert columns")
		return
	}
	workbook, _, ok := h.refreshWorkbook(r, id)
	if !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "workbook not found"})
		return
	}
	window := parseWindowRequest(r)
	sheet, err := h.storage.GetSheetWindow(id, req.Sheet, window.rowStart, window.rowCount, window.colStart, window.colCount)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load updated sheet"})
		return
	}
	writeJSON(w, http.StatusOK, models.SheetResponse{Workbook: workbook, Sheet: sheet})
}

func (h SheetHandler) loadWorkbook(r *http.Request, id string) (models.Workbook, map[string]models.Sheet, bool) {
	user, ok := CurrentUser(r)
	if !ok {
		return models.Workbook{}, nil, false
	}
	if cached, ok := h.cache.GetByID(id); ok {
		workbook, sheets, err := h.storage.GetWorkbookByIDForUser(user.ID, cached.Workbook.ID)
		if err == nil {
			return workbook, sheets, true
		}
	}
	workbook, sheets, err := h.storage.GetWorkbookByIDForUser(user.ID, id)
	if err != nil {
		return models.Workbook{}, nil, false
	}
	h.cache.Put(cache.CachedWorkbook{Workbook: workbook})
	return workbook, sheets, true
}

func (h SheetHandler) refreshWorkbook(r *http.Request, id string) (models.Workbook, map[string]models.Sheet, bool) {
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

func (h SheetHandler) writeStorageError(w http.ResponseWriter, err error, fallback string) {
	switch err {
	case storage.ErrNotFound:
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "sheet not found"})
	case storage.ErrConflict:
		writeJSON(w, http.StatusConflict, models.ErrorResponse{Error: "sheet already exists"})
	case storage.ErrInvalid:
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: fallback})
	default:
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: fallback})
	}
}

func parseWindowRequest(r *http.Request) cellWindowRequest {
	parse := func(key string, fallback int) int {
		raw := strings.TrimSpace(r.URL.Query().Get(key))
		if raw == "" {
			return fallback
		}
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 {
			return fallback
		}
		return parsed
	}
	return cellWindowRequest{
		rowStart: parse("rowStart", 1),
		rowCount: parse("rowCount", defaultInitialRowCount),
		colStart: parse("colStart", 1),
		colCount: parse("colCount", defaultInitialColCount),
	}
}

func fallbackSheet(sheets map[string]models.Sheet) models.Sheet {
	if len(sheets) == 0 {
		return models.Sheet{}
	}
	all := make([]models.Sheet, 0, len(sheets))
	for _, sheet := range sheets {
		all = append(all, sheet)
	}
	sort.Slice(all, func(i, j int) bool {
		return all[i].Index < all[j].Index
	})
	return all[0]
}
