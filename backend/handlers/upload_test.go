package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/xuri/excelize/v2"

	"rowful/cache"
	"rowful/config"
	"rowful/models"
	"rowful/storage"
)

func TestUploadPersistsWorkbookWithoutWritingOriginalFile(t *testing.T) {
	store, user := newUploadTestStore(t)
	handler := NewUploadHandler(config.Config{
		MaxFileSizeBytes: 5 * 1024 * 1024,
		UploadDir:        "/definitely/not/writable",
	}, cache.New(), store)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", "import.xlsx")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := part.Write(buildTestWorkbookBytes(t)); err != nil {
		t.Fatalf("write xlsx payload: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, user))
	rec := httptest.NewRecorder()

	handler.Handle(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d: %s", http.StatusOK, rec.Code, rec.Body.String())
	}

	var resp models.UploadResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode upload response: %v", err)
	}

	files, err := store.ListFilesForUser(user.ID, 0)
	if err != nil {
		t.Fatalf("list files: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("expected 1 stored file, got %d", len(files))
	}
	if files[0].FilePath != "" {
		t.Fatalf("expected empty file path, got %q", files[0].FilePath)
	}
	if resp.Workbook.ID == "" {
		t.Fatalf("expected upload response workbook ID to be set")
	}
}

func newUploadTestStore(t *testing.T) (*storage.Store, models.AuthUser) {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "rowful-upload-test.db")
	store, err := storage.New(dbPath, "test-app-encryption-key-1234567890")
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})

	user, err := store.CreateUser("Upload User", "upload@example.com", "hash")
	if err != nil {
		t.Fatalf("create test user: %v", err)
	}

	return store, user
}

func buildTestWorkbookBytes(t *testing.T) []byte {
	t.Helper()

	file := excelize.NewFile()
	if err := file.SetCellValue("Sheet1", "A1", "hello"); err != nil {
		t.Fatalf("seed workbook cell: %v", err)
	}
	buffer, err := file.WriteToBuffer()
	_ = file.Close()
	if err != nil {
		t.Fatalf("serialize workbook: %v", err)
	}
	return buffer.Bytes()
}
