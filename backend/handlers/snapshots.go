package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"rowful/models"
	"rowful/snapshots"
	"rowful/storage"
)

type SnapshotsHandler struct {
	storage *storage.Store
	service *snapshots.Service
}

type snapshotSettingsRequest struct {
	Enabled               bool   `json:"enabled"`
	Endpoint              string `json:"endpoint"`
	Region                string `json:"region"`
	Bucket                string `json:"bucket"`
	Prefix                string `json:"prefix"`
	AccessKeyID           string `json:"accessKeyId"`
	SecretAccessKey       string `json:"secretAccessKey"`
	ClearSecretAccessKey  bool   `json:"clearSecretAccessKey"`
	UsePathStyle          bool   `json:"usePathStyle"`
	ScheduleIntervalHours int    `json:"scheduleIntervalHours"`
	RetentionCount        int    `json:"retentionCount"`
}

type snapshotRestoreRequest struct {
	RunID string `json:"runId"`
}

func NewSnapshotsHandler(storageStore *storage.Store, service *snapshots.Service) SnapshotsHandler {
	return SnapshotsHandler{storage: storageStore, service: service}
}

func (h SnapshotsHandler) Get(w http.ResponseWriter, _ *http.Request) {
	response, err := h.buildResponse()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load snapshot settings"})
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h SnapshotsHandler) Update(w http.ResponseWriter, r *http.Request) {
	var req snapshotSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return
	}

	current, err := h.storage.GetSnapshotSettings()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load snapshot settings"})
		return
	}

	secret := strings.TrimSpace(req.SecretAccessKey)
	hasSecret := secret != ""
	if !req.ClearSecretAccessKey && !hasSecret && current.HasSecretAccessKey {
		hasSecret = true
	}

	nextSettings := models.SnapshotSettings{
		Enabled:               req.Enabled,
		Endpoint:              req.Endpoint,
		Region:                req.Region,
		Bucket:                req.Bucket,
		Prefix:                req.Prefix,
		AccessKeyID:           req.AccessKeyID,
		SecretAccessKey:       secret,
		HasSecretAccessKey:    hasSecret,
		UsePathStyle:          req.UsePathStyle,
		ScheduleIntervalHours: req.ScheduleIntervalHours,
		RetentionCount:        req.RetentionCount,
	}
	if nextSettings.Enabled && strings.TrimSpace(nextSettings.Bucket) == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "bucket is required before enabling snapshots"})
		return
	}
	if nextSettings.Enabled && strings.TrimSpace(nextSettings.AccessKeyID) == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "access key ID is required before enabling snapshots"})
		return
	}
	if nextSettings.Enabled && !hasSecret {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "secret access key is required before enabling snapshots"})
		return
	}

	settings, err := h.storage.UpdateSnapshotSettings(nextSettings)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to save snapshot settings"})
		return
	}

	if err := h.service.ApplySchedule(settings); err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to update snapshot schedule"})
		return
	}

	response, err := h.buildResponse()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to reload snapshot settings"})
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h SnapshotsHandler) Run(w http.ResponseWriter, r *http.Request) {
	run, _, err := h.service.Trigger(r.Context(), models.SnapshotTriggerManual)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: err.Error()})
		return
	}

	response, buildErr := h.buildResponse()
	if buildErr != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to reload snapshot status"})
		return
	}
	if len(response.Runs) == 0 {
		response.Runs = append(response.Runs, run)
	}
	writeJSON(w, http.StatusAccepted, response)
}

func (h SnapshotsHandler) Restore(w http.ResponseWriter, r *http.Request) {
	var req snapshotRestoreRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return
	}

	if err := h.service.Restore(r.Context(), req.RunID); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: err.Error()})
		return
	}

	response, err := h.buildResponse()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to reload snapshot status"})
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h SnapshotsHandler) buildResponse() (models.SnapshotStatusResponse, error) {
	settings, err := h.storage.GetSnapshotSettings()
	if err != nil {
		return models.SnapshotStatusResponse{}, err
	}
	settings.NextRunAt = h.service.PreviewNextRun(settings)
	settings.SecretAccessKey = ""

	runs, err := h.storage.ListSnapshotRuns(10)
	if err != nil {
		return models.SnapshotStatusResponse{}, err
	}

	return models.SnapshotStatusResponse{
		Settings:    settings,
		Runs:        runs,
		IsRunning:   h.service.IsRunning(),
		IsRestoring: h.service.IsRestoring(),
		Targets:     h.service.Targets(),
	}, nil
}
