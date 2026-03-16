package models

import "time"

const (
	SnapshotStatusRunning = "running"
	SnapshotStatusSuccess = "success"
	SnapshotStatusFailed  = "failed"

	SnapshotTriggerManual    = "manual"
	SnapshotTriggerScheduled = "scheduled"
)

type SnapshotSettings struct {
	Enabled               bool       `json:"enabled"`
	Endpoint              string     `json:"endpoint"`
	Region                string     `json:"region"`
	Bucket                string     `json:"bucket"`
	Prefix                string     `json:"prefix"`
	AccessKeyID           string     `json:"accessKeyId"`
	SecretAccessKey       string     `json:"secretAccessKey,omitempty"`
	HasSecretAccessKey    bool       `json:"hasSecretAccessKey"`
	UsePathStyle          bool       `json:"usePathStyle"`
	ScheduleIntervalHours int        `json:"scheduleIntervalHours"`
	RetentionCount        int        `json:"retentionCount"`
	LastSnapshotAt        *time.Time `json:"lastSnapshotAt,omitempty"`
	LastSuccessAt         *time.Time `json:"lastSuccessAt,omitempty"`
	NextRunAt             *time.Time `json:"nextRunAt,omitempty"`
	LastError             string     `json:"lastError,omitempty"`
	UpdatedAt             time.Time  `json:"updatedAt"`
}

func (s SnapshotSettings) IsConfigured() bool {
	return s.Bucket != "" && s.AccessKeyID != "" && s.SecretAccessKey != ""
}

type SnapshotRun struct {
	ID          string     `json:"id"`
	Status      string     `json:"status"`
	Trigger     string     `json:"trigger"`
	ObjectKey   string     `json:"objectKey,omitempty"`
	SizeBytes   int64      `json:"sizeBytes"`
	StartedAt   time.Time  `json:"startedAt"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
	Error       string     `json:"error,omitempty"`
}

type SnapshotStatusResponse struct {
	Settings    SnapshotSettings `json:"settings"`
	Runs        []SnapshotRun    `json:"runs"`
	IsRunning   bool             `json:"isRunning"`
	IsRestoring bool             `json:"isRestoring"`
	Targets     []string         `json:"targets"`
}
