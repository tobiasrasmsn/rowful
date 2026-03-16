package storage

import (
	"testing"

	"rowful/models"
)

func TestSnapshotSettingsPreserveStoredSecret(t *testing.T) {
	store, err := New(t.TempDir()+"/rowful.db", "test-app-encryption-key-1234567890")
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	defer func() { _ = store.Close() }()

	initial, err := store.UpdateSnapshotSettings(models.SnapshotSettings{
		Enabled:               true,
		Endpoint:              "https://example.com",
		Region:                "auto",
		Bucket:                "rowful-backups",
		Prefix:                "snapshots",
		AccessKeyID:           "access-key",
		SecretAccessKey:       "secret-key",
		HasSecretAccessKey:    true,
		UsePathStyle:          false,
		ScheduleIntervalHours: 24,
		RetentionCount:        14,
	})
	if err != nil {
		t.Fatalf("save initial snapshot settings: %v", err)
	}
	if initial.SecretAccessKey != "secret-key" {
		t.Fatalf("expected decrypted secret to be returned")
	}

	updated, err := store.UpdateSnapshotSettings(models.SnapshotSettings{
		Enabled:               true,
		Endpoint:              "https://example.com",
		Region:                "auto",
		Bucket:                "rowful-backups",
		Prefix:                "nightly",
		AccessKeyID:           "access-key",
		HasSecretAccessKey:    true,
		UsePathStyle:          true,
		ScheduleIntervalHours: 12,
		RetentionCount:        7,
	})
	if err != nil {
		t.Fatalf("update snapshot settings without new secret: %v", err)
	}

	if updated.SecretAccessKey != "secret-key" {
		t.Fatalf("expected secret to be preserved, got %q", updated.SecretAccessKey)
	}
	if updated.Prefix != "nightly" {
		t.Fatalf("expected updated prefix, got %q", updated.Prefix)
	}
	if !updated.UsePathStyle {
		t.Fatalf("expected path style setting to be updated")
	}
}
