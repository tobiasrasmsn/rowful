package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"planar/cache"
	"planar/models"
	"planar/storage"
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

func NewFilesHandler(cacheStore *cache.Store, storageStore *storage.Store) FilesHandler {
	initEmailDispatcher()
	return FilesHandler{cache: cacheStore, storage: storageStore}
}

func (h FilesHandler) List(w http.ResponseWriter, _ *http.Request) {
	files, err := h.storage.ListFiles(0)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to list files"})
		return
	}
	writeJSON(w, http.StatusOK, models.FilesResponse{Files: files})
}

func (h FilesHandler) Recent(w http.ResponseWriter, r *http.Request) {
	limit := 10
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}

	files, err := h.storage.ListRecentFiles(limit)
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

	workbook, sheets, ok := h.refreshWorkbook(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "file not found"})
		return
	}
	if err := h.storage.TouchWorkbookOpened(id); err == nil {
		workbook, sheets, _ = h.refreshWorkbook(id)
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
	writeJSON(w, http.StatusOK, models.SheetResponse{Workbook: workbook, Sheet: sheet})
}

func (h FilesHandler) Rename(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing file id"})
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

	filePath, err := h.storage.DeleteWorkbook(id)
	if err != nil {
		if err == storage.ErrNotFound {
			writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "file not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to delete file"})
		return
	}

	h.cache.DeleteByID(id)
	if filePath != "" {
		_ = os.Remove(filePath)
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h FilesHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing file id"})
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

func (h FilesHandler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing file id"})
		return
	}

	var req updateFileSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return
	}

	settings, err := h.storage.UpdateFileSettings(id, req.Settings)
	if err != nil {
		if err == storage.ErrNotFound {
			writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "file not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to update file settings"})
		return
	}
	writeJSON(w, http.StatusOK, models.FileSettingsResponse{Settings: settings})
}

func (h FilesHandler) refreshWorkbook(id string) (models.Workbook, map[string]models.Sheet, bool) {
	workbook, sheets, err := h.storage.GetWorkbookByID(id)
	if err != nil {
		return models.Workbook{}, nil, false
	}
	h.cache.Put(cache.CachedWorkbook{Workbook: workbook})
	return workbook, sheets, true
}
