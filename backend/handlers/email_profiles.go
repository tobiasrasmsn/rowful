package handlers

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"

	"rowful/models"
	"rowful/storage"
)

type EmailProfilesHandler struct {
	storage *storage.Store
}

type emailProfileRequest struct {
	Profile models.EmailProfileInput `json:"profile"`
}

func NewEmailProfilesHandler(storageStore *storage.Store) EmailProfilesHandler {
	return EmailProfilesHandler{storage: storageStore}
}

func (h EmailProfilesHandler) List(w http.ResponseWriter, r *http.Request) {
	user, ok := CurrentUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
		return
	}

	profiles, err := h.storage.ListEmailProfiles(user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load email profiles"})
		return
	}
	writeJSON(w, http.StatusOK, models.EmailProfilesResponse{Profiles: profiles})
}

func (h EmailProfilesHandler) Create(w http.ResponseWriter, r *http.Request) {
	user, ok := CurrentUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
		return
	}

	req, ok := decodeEmailProfileRequest(w, r)
	if !ok {
		return
	}

	profile, err := h.storage.CreateEmailProfile(user.ID, req.Profile)
	if err != nil {
		if err == storage.ErrInvalid {
			writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "nickname is required"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to create email profile"})
		return
	}
	writeJSON(w, http.StatusCreated, models.EmailProfileResponse{Profile: profile})
}

func (h EmailProfilesHandler) Update(w http.ResponseWriter, r *http.Request) {
	user, ok := CurrentUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
		return
	}

	profileID := chi.URLParam(r, "id")
	if profileID == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing email profile id"})
		return
	}

	req, ok := decodeEmailProfileRequest(w, r)
	if !ok {
		return
	}

	profile, err := h.storage.UpdateEmailProfile(user.ID, profileID, req.Profile)
	if err != nil {
		switch err {
		case storage.ErrInvalid:
			writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "nickname is required"})
			return
		case storage.ErrNotFound:
			writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "email profile not found"})
			return
		default:
			writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to update email profile"})
			return
		}
	}
	writeJSON(w, http.StatusOK, models.EmailProfileResponse{Profile: profile})
}

func (h EmailProfilesHandler) Delete(w http.ResponseWriter, r *http.Request) {
	user, ok := CurrentUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
		return
	}

	profileID := chi.URLParam(r, "id")
	if profileID == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing email profile id"})
		return
	}

	if err := h.storage.DeleteEmailProfile(user.ID, profileID); err != nil {
		switch err {
		case storage.ErrInvalid:
			writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid email profile id"})
			return
		case storage.ErrNotFound:
			writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "email profile not found"})
			return
		default:
			writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to delete email profile"})
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func decodeEmailProfileRequest(w http.ResponseWriter, r *http.Request) (emailProfileRequest, bool) {
	var req emailProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err != io.EOF {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return emailProfileRequest{}, false
	}
	return req, true
}
