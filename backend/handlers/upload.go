package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/google/uuid"

	"rowful/cache"
	"rowful/config"
	"rowful/models"
	"rowful/parser"
	"rowful/storage"
)

type UploadHandler struct {
	cfg     config.Config
	cache   *cache.Store
	storage *storage.Store
}

func NewUploadHandler(cfg config.Config, cacheStore *cache.Store, storageStore *storage.Store) UploadHandler {
	return UploadHandler{cfg: cfg, cache: cacheStore, storage: storageStore}
}

func (h UploadHandler) Handle(w http.ResponseWriter, r *http.Request) {
	user, ok := CurrentUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
		return
	}

	if err := r.ParseMultipartForm(h.cfg.MaxFileSizeBytes); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid multipart form"})
		return
	}
	folderID := strings.TrimSpace(r.FormValue("folderId"))

	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing file field"})
		return
	}
	defer func() { _ = file.Close() }()

	if strings.ToLower(filepath.Ext(header.Filename)) != ".xlsx" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "only .xlsx files are supported"})
		return
	}

	reader := io.LimitReader(file, h.cfg.MaxFileSizeBytes+1)
	fileBytes, err := io.ReadAll(reader)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "failed to read upload"})
		return
	}
	if int64(len(fileBytes)) > h.cfg.MaxFileSizeBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, models.ErrorResponse{Error: fmt.Sprintf("file exceeds %d MB", h.cfg.MaxFileSizeBytes/(1024*1024))})
		return
	}

	hashBytes := sha256.Sum256(fileBytes)
	rawHash := hex.EncodeToString(hashBytes[:])
	fileHash := storage.ScopeFileHash(user.ID, rawHash)

	if cached, ok := h.cache.GetByHash(fileHash); ok {
		if workbook, sheets, err := h.storage.GetWorkbookByIDForUser(user.ID, cached.Workbook.ID); err == nil {
			_ = h.storage.TouchWorkbookOpened(workbook.ID)
			h.cache.Put(cache.CachedWorkbook{Workbook: workbook})
			sheetName := workbook.ActiveSheet
			if _, exists := sheets[sheetName]; !exists {
				sheetName = fallbackSheet(sheets).Name
			}
			sheet, loadErr := h.storage.GetSheetWindow(workbook.ID, sheetName, 1, defaultInitialRowCount, 1, defaultInitialColCount)
			if loadErr == nil {
				regions, regionsErr := h.storage.GetKanbanRegions(workbook.ID)
				if regionsErr != nil {
					writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load kanban regions"})
					return
				}
				writeJSON(w, http.StatusOK, models.UploadResponse{Workbook: workbook, Sheet: sheet, KanbanRegions: regions})
				return
			}
		}
	}

	if workbook, sheets, found, err := h.storage.GetWorkbookByHashForUser(user.ID, fileHash); err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load workbook from storage"})
		return
	} else if found {
		_ = h.storage.TouchWorkbookOpened(workbook.ID)
		h.cache.Put(cache.CachedWorkbook{Workbook: workbook})
		sheetName := workbook.ActiveSheet
		if _, ok := sheets[sheetName]; !ok {
			sheetName = fallbackSheet(sheets).Name
		}
		sheet, loadErr := h.storage.GetSheetWindow(workbook.ID, sheetName, 1, defaultInitialRowCount, 1, defaultInitialColCount)
		if loadErr != nil {
			writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load workbook sheet"})
			return
		}
		regions, regionsErr := h.storage.GetKanbanRegions(workbook.ID)
		if regionsErr != nil {
			writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load kanban regions"})
			return
		}
		writeJSON(w, http.StatusOK, models.UploadResponse{Workbook: workbook, Sheet: sheet, KanbanRegions: regions})
		return
	}

	sheets, err := parser.ParseWorkbook(fileBytes)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "failed to parse xlsx"})
		return
	}

	id := uuid.NewString()
	workbookMeta := cache.BuildWorkbookMeta(id, header.Filename, fileHash, sheets)

	if err := h.storage.SaveWorkbook(user.ID, workbookMeta, sheets, folderID); err != nil {
		if err == storage.ErrNotFound {
			writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "folder not found"})
			return
		}
		if err == storage.ErrInvalid {
			writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid folder"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to persist workbook"})
		return
	}

	h.cache.Put(cache.CachedWorkbook{Workbook: workbookMeta})
	sheet, err := h.storage.GetSheetWindow(workbookMeta.ID, workbookMeta.ActiveSheet, 1, defaultInitialRowCount, 1, defaultInitialColCount)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load imported workbook"})
		return
	}
	regions, regionsErr := h.storage.GetKanbanRegions(workbookMeta.ID)
	if regionsErr != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load kanban regions"})
		return
	}
	writeJSON(w, http.StatusOK, models.UploadResponse{Workbook: workbookMeta, Sheet: sheet, KanbanRegions: regions})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func WriteJSON(w http.ResponseWriter, status int, payload any) {
	writeJSON(w, status, payload)
}
