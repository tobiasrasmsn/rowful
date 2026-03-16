package snapshots

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/s3"

	"rowful/appstate"
	"rowful/cache"
	"rowful/config"
	"rowful/models"
	"rowful/storage"
)

func TestRestoreReplacesDatabaseAndUploads(t *testing.T) {
	baseDir := t.TempDir()
	dbPath := filepath.Join(baseDir, "rowful.db")
	uploadDir := filepath.Join(baseDir, "uploads")
	if err := os.MkdirAll(uploadDir, 0o755); err != nil {
		t.Fatalf("create uploads dir: %v", err)
	}

	store, err := storage.New(dbPath, "test-app-encryption-key-1234567890")
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})

	cacheStore := cache.New()
	service := NewService(config.Config{
		DatabasePath: dbPath,
		UploadDir:    uploadDir,
	}, store, cacheStore, appstate.NewDataGate())

	if _, err := store.UpdateSnapshotSettings(models.SnapshotSettings{
		Enabled:               true,
		Bucket:                "rowful-backups",
		AccessKeyID:           "access-key",
		SecretAccessKey:       "secret-key",
		HasSecretAccessKey:    true,
		ScheduleIntervalHours: 24,
		RetentionCount:        14,
	}); err != nil {
		t.Fatalf("save snapshot settings: %v", err)
	}

	beforeUser, err := store.CreateUser("Before User", "before@example.com", "hash")
	if err != nil {
		t.Fatalf("create initial user: %v", err)
	}
	runningRun, err := store.CreateSnapshotRun(models.SnapshotTriggerScheduled)
	if err != nil {
		t.Fatalf("create in-progress snapshot run: %v", err)
	}
	if err := os.WriteFile(filepath.Join(uploadDir, "state.txt"), []byte("before"), 0o644); err != nil {
		t.Fatalf("write initial upload: %v", err)
	}

	build, err := service.buildArchive(models.SnapshotSettings{Prefix: "snapshots"})
	if err != nil {
		t.Fatalf("build snapshot archive: %v", err)
	}
	archiveBytes, err := os.ReadFile(build.path)
	if err != nil {
		build.cleanup()
		t.Fatalf("read snapshot archive: %v", err)
	}
	build.cleanup()

	currentSettings, err := store.UpdateSnapshotSettings(models.SnapshotSettings{
		Enabled:               true,
		Bucket:                "rowful-live-backups",
		AccessKeyID:           "live-access-key",
		SecretAccessKey:       "secret-key",
		HasSecretAccessKey:    true,
		Prefix:                "current",
		ScheduleIntervalHours: 12,
		RetentionCount:        21,
	})
	if err != nil {
		t.Fatalf("update current snapshot settings: %v", err)
	}
	if err := service.ApplySchedule(currentSettings); err != nil {
		t.Fatalf("seed current snapshot schedule: %v", err)
	}

	if _, err := store.UpdateSignupPolicy(true, false); err != nil {
		t.Fatalf("enable signups for mutation: %v", err)
	}
	if _, err := store.CreateUser("After User", "after@example.com", "hash"); err != nil {
		t.Fatalf("create post-snapshot user: %v", err)
	}
	if err := os.WriteFile(filepath.Join(uploadDir, "state.txt"), []byte("after"), 0o644); err != nil {
		t.Fatalf("mutate upload: %v", err)
	}
	if err := os.WriteFile(filepath.Join(uploadDir, "new.txt"), []byte("new"), 0o644); err != nil {
		t.Fatalf("write extra upload: %v", err)
	}
	cacheStore.Put(cache.CachedWorkbook{
		Workbook: models.Workbook{ID: "cached", FileHash: "cache-hash"},
	})

	run, err := store.CreateSnapshotRun(models.SnapshotTriggerManual)
	if err != nil {
		t.Fatalf("create snapshot run: %v", err)
	}
	completedAt := time.Now().UTC()
	run.Status = models.SnapshotStatusSuccess
	run.ObjectKey = "snapshots/test.zip"
	run.CompletedAt = &completedAt
	run.SizeBytes = int64(len(archiveBytes))
	if err := store.FinalizeSnapshotRun(run, nil); err != nil {
		t.Fatalf("finalize snapshot run: %v", err)
	}

	service.newClient = func(context.Context, models.SnapshotSettings) (objectStorageClient, error) {
		return fakeObjectStorageClient{
			getObject: func(_ context.Context, input *s3.GetObjectInput, _ ...func(*s3.Options)) (*s3.GetObjectOutput, error) {
				if got := *input.Key; got != run.ObjectKey {
					t.Fatalf("expected restore key %q, got %q", run.ObjectKey, got)
				}
				return &s3.GetObjectOutput{
					Body: io.NopCloser(bytes.NewReader(archiveBytes)),
				}, nil
			},
		}, nil
	}

	if err := service.Restore(context.Background(), run.ID); err != nil {
		t.Fatalf("restore snapshot: %v", err)
	}

	if _, _, err := store.GetUserByEmail(beforeUser.Email); err != nil {
		t.Fatalf("expected initial user to exist after restore: %v", err)
	}
	if _, _, err := store.GetUserByEmail("after@example.com"); err != storage.ErrNotFound {
		t.Fatalf("expected post-snapshot user to be removed, got %v", err)
	}

	restoredUpload, err := os.ReadFile(filepath.Join(uploadDir, "state.txt"))
	if err != nil {
		t.Fatalf("read restored upload: %v", err)
	}
	if string(restoredUpload) != "before" {
		t.Fatalf("expected restored upload contents %q, got %q", "before", string(restoredUpload))
	}
	if _, err := os.Stat(filepath.Join(uploadDir, "new.txt")); !os.IsNotExist(err) {
		t.Fatalf("expected extra upload to be removed, got %v", err)
	}

	if _, ok := cacheStore.GetByID("cached"); ok {
		t.Fatalf("expected workbook cache to be cleared after restore")
	}

	restoredRuns, err := store.ListSnapshotRuns(10)
	if err != nil {
		t.Fatalf("list restored snapshot runs: %v", err)
	}
	var restoredSnapshotRun *models.SnapshotRun
	for index := range restoredRuns {
		if restoredRuns[index].ID == run.ID {
			restoredSnapshotRun = &restoredRuns[index]
			break
		}
	}
	if restoredSnapshotRun == nil {
		t.Fatalf("expected restored successful snapshot run to still exist in history")
	}
	if restoredSnapshotRun.Status != models.SnapshotStatusSuccess {
		t.Fatalf("expected restored snapshot run to remain successful, got %q", restoredSnapshotRun.Status)
	}
	if restoredSnapshotRun.ObjectKey != run.ObjectKey {
		t.Fatalf("expected restored snapshot run object key %q, got %q", run.ObjectKey, restoredSnapshotRun.ObjectKey)
	}

	for _, restoredRun := range restoredRuns {
		if restoredRun.ID == runningRun.ID {
			t.Fatalf("expected stale in-progress run metadata to be removed during restore")
		}
	}

	restoredSettings, err := store.GetSnapshotSettings()
	if err != nil {
		t.Fatalf("load restored snapshot settings: %v", err)
	}
	if restoredSettings.Prefix != currentSettings.Prefix {
		t.Fatalf("expected current snapshot prefix %q, got %q", currentSettings.Prefix, restoredSettings.Prefix)
	}
	if restoredSettings.ScheduleIntervalHours != currentSettings.ScheduleIntervalHours {
		t.Fatalf("expected current snapshot interval %d, got %d", currentSettings.ScheduleIntervalHours, restoredSettings.ScheduleIntervalHours)
	}
	if restoredSettings.NextRunAt == nil {
		t.Fatalf("expected current snapshot schedule to remain populated after restore")
	}
}

type fakeObjectStorageClient struct {
	getObject func(context.Context, *s3.GetObjectInput, ...func(*s3.Options)) (*s3.GetObjectOutput, error)
}

func (f fakeObjectStorageClient) PutObject(context.Context, *s3.PutObjectInput, ...func(*s3.Options)) (*s3.PutObjectOutput, error) {
	return nil, nil
}

func (f fakeObjectStorageClient) ListObjectsV2(context.Context, *s3.ListObjectsV2Input, ...func(*s3.Options)) (*s3.ListObjectsV2Output, error) {
	return nil, nil
}

func (f fakeObjectStorageClient) DeleteObject(context.Context, *s3.DeleteObjectInput, ...func(*s3.Options)) (*s3.DeleteObjectOutput, error) {
	return nil, nil
}

func (f fakeObjectStorageClient) GetObject(ctx context.Context, input *s3.GetObjectInput, options ...func(*s3.Options)) (*s3.GetObjectOutput, error) {
	return f.getObject(ctx, input, options...)
}
