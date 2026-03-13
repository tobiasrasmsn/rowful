package handlers

import (
	"net/http"

	"rowful/models"
	"rowful/storage"
)

func requireWorkbookAccess(r *http.Request, store *storage.Store, workbookID string) (models.AuthUser, error) {
	user, ok := CurrentUser(r)
	if !ok {
		return models.AuthUser{}, storage.ErrForbidden
	}
	if err := store.EnsureWorkbookAccess(user.ID, workbookID); err != nil {
		return models.AuthUser{}, err
	}
	return user, nil
}
