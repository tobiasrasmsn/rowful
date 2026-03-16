package snapshots

import (
	"testing"

	"rowful/models"
)

func TestPreviewNextRunReturnsFutureValueForConfiguredScheduleWithoutStoredTimestamp(t *testing.T) {
	service := &Service{}
	nextRun := service.PreviewNextRun(models.SnapshotSettings{
		Enabled:               true,
		Bucket:                "rowful-backups",
		AccessKeyID:           "access-key",
		HasSecretAccessKey:    true,
		ScheduleIntervalHours: 12,
	})
	if nextRun == nil {
		t.Fatalf("expected next run preview to be available")
	}
}
