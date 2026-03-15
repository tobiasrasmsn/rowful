package handlers

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"rowful/config"
	"rowful/models"
	"rowful/storage"
)

const (
	sessionCookieName     = "rowful_session"
	sessionLifetime       = 30 * 24 * time.Hour
	minimumPasswordLength = 12
	maximumPasswordBytes  = 72
)

type authContextKey string

const (
	userContextKey    authContextKey = "auth_user"
	sessionContextKey authContextKey = "auth_session"
)

type AuthHandler struct {
	cfg     config.Config
	storage *storage.Store
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type signupRequest struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type allowlistRequest struct {
	Email string `json:"email"`
}

type signupPolicyRequest struct {
	SignupsEnabled bool `json:"signupsEnabled"`
	InviteOnly     bool `json:"inviteOnly"`
}

func NewAuthHandler(cfg config.Config, storageStore *storage.Store) AuthHandler {
	return AuthHandler{cfg: cfg, storage: storageStore}
}

func (h AuthHandler) Session(w http.ResponseWriter, r *http.Request) {
	response, clearCookie := h.sessionResponse(r)
	if clearCookie {
		clearSessionCookie(w, r)
	}
	writeJSON(w, http.StatusOK, response)
}

func (h AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return
	}

	user, passwordHash, err := h.storage.GetUserByEmail(req.Email)
	if err != nil {
		if err == storage.ErrNotFound {
			writeJSON(w, http.StatusUnauthorized, models.ErrorResponse{Error: "invalid email or password"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load user"})
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)) != nil {
		writeJSON(w, http.StatusUnauthorized, models.ErrorResponse{Error: "invalid email or password"})
		return
	}

	csrfToken, sessionToken, tokenHash, err := buildSessionSecrets()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to create session"})
		return
	}
	expiresAt := time.Now().UTC().Add(sessionLifetime)
	if err := h.storage.CreateSession(user.ID, tokenHash, csrfToken, expiresAt); err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to persist session"})
		return
	}

	setSessionCookie(w, r, sessionToken, expiresAt)
	bootstrap, err := h.storage.GetBootstrapState()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load auth state"})
		return
	}
	writeJSON(w, http.StatusOK, models.AuthSessionResponse{
		Authenticated:           true,
		User:                    &user,
		CSRFToken:               csrfToken,
		Bootstrap:               bootstrap,
		DomainManagementEnabled: h.cfg.DomainManagementEnabled(),
	})
}

func (h AuthHandler) Signup(w http.ResponseWriter, r *http.Request) {
	var req signupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return
	}
	if err := validateSignupRequest(req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: err.Error()})
		return
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to hash password"})
		return
	}

	user, err := h.storage.CreateUser(req.Name, req.Email, string(passwordHash))
	if err != nil {
		switch err {
		case storage.ErrConflict:
			writeJSON(w, http.StatusConflict, models.ErrorResponse{Error: "an account with that email already exists"})
		case storage.ErrForbidden:
			bootstrap, bootstrapErr := h.storage.GetBootstrapState()
			if bootstrapErr == nil && bootstrap.InviteOnly {
				writeJSON(w, http.StatusForbidden, models.ErrorResponse{Error: "this email is not on the signup whitelist"})
				return
			}
			writeJSON(w, http.StatusForbidden, models.ErrorResponse{Error: "sign up is currently disabled"})
		default:
			writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to create account"})
		}
		return
	}

	csrfToken, sessionToken, tokenHash, err := buildSessionSecrets()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to create session"})
		return
	}
	expiresAt := time.Now().UTC().Add(sessionLifetime)
	if err := h.storage.CreateSession(user.ID, tokenHash, csrfToken, expiresAt); err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to persist session"})
		return
	}

	setSessionCookie(w, r, sessionToken, expiresAt)
	bootstrap, err := h.storage.GetBootstrapState()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load auth state"})
		return
	}
	writeJSON(w, http.StatusCreated, models.AuthSessionResponse{
		Authenticated:           true,
		User:                    &user,
		CSRFToken:               csrfToken,
		Bootstrap:               bootstrap,
		DomainManagementEnabled: h.cfg.DomainManagementEnabled(),
	})
}

func (h AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(sessionCookieName); err == nil {
		_ = h.storage.DeleteSessionByTokenHash(hashSessionToken(cookie.Value))
	}
	clearSessionCookie(w, r)
	bootstrap, err := h.storage.GetBootstrapState()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load auth state"})
		return
	}
	writeJSON(w, http.StatusOK, models.AuthSessionResponse{
		Authenticated:           false,
		Bootstrap:               bootstrap,
		DomainManagementEnabled: h.cfg.DomainManagementEnabled(),
	})
}

func (h AuthHandler) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session, user, err := h.authenticateRequest(r)
		if err != nil {
			clearSessionCookie(w, r)
			writeJSON(w, http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
			return
		}
		if requiresCSRFFCheck(r.Method) {
			if subtleCompare(strings.TrimSpace(r.Header.Get("X-CSRF-Token")), session.CSRFToken) == 0 {
				writeJSON(w, http.StatusForbidden, models.ErrorResponse{Error: "invalid CSRF token"})
				return
			}
		}
		ctx := context.WithValue(r.Context(), userContextKey, user)
		ctx = context.WithValue(ctx, sessionContextKey, session)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (h AuthHandler) RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := CurrentUser(r)
		if !ok || !user.IsAdmin {
			writeJSON(w, http.StatusForbidden, models.ErrorResponse{Error: "admin access required"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (h AuthHandler) ListAllowlist(w http.ResponseWriter, _ *http.Request) {
	entries, err := h.storage.ListAllowlistEntries()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load allowlist"})
		return
	}
	writeJSON(w, http.StatusOK, models.AllowlistResponse{Entries: entries})
}

func (h AuthHandler) GetSignupPolicy(w http.ResponseWriter, _ *http.Request) {
	bootstrap, err := h.storage.GetBootstrapState()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load signup policy"})
		return
	}
	writeJSON(w, http.StatusOK, bootstrap)
}

func (h AuthHandler) UpdateSignupPolicy(w http.ResponseWriter, r *http.Request) {
	var req signupPolicyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return
	}

	bootstrap, err := h.storage.UpdateSignupPolicy(req.SignupsEnabled, req.InviteOnly)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to update signup policy"})
		return
	}
	writeJSON(w, http.StatusOK, bootstrap)
}

func (h AuthHandler) AddAllowlist(w http.ResponseWriter, r *http.Request) {
	user, ok := CurrentUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
		return
	}

	var req allowlistRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return
	}
	if _, err := normalizeEmailAddress(req.Email); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: err.Error()})
		return
	}

	entry, err := h.storage.AddAllowlistEntry(req.Email, user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to update allowlist"})
		return
	}
	writeJSON(w, http.StatusCreated, entry)
}

func (h AuthHandler) DeleteAllowlist(w http.ResponseWriter, r *http.Request) {
	email := strings.TrimSpace(r.URL.Query().Get("email"))
	if email == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "email is required"})
		return
	}
	if err := h.storage.DeleteAllowlistEntry(email); err != nil {
		switch err {
		case storage.ErrConflict:
			writeJSON(w, http.StatusConflict, models.ErrorResponse{Error: "used allowlist entries cannot be removed"})
		case storage.ErrNotFound:
			writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "allowlist entry not found"})
		default:
			writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to delete allowlist entry"})
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func CurrentUser(r *http.Request) (models.AuthUser, bool) {
	user, ok := r.Context().Value(userContextKey).(models.AuthUser)
	return user, ok
}

func (h AuthHandler) sessionResponse(r *http.Request) (models.AuthSessionResponse, bool) {
	bootstrap, err := h.storage.GetBootstrapState()
	if err != nil {
		return models.AuthSessionResponse{Authenticated: false}, false
	}

	session, user, err := h.authenticateRequest(r)
	if err != nil {
		return models.AuthSessionResponse{
			Authenticated:           false,
			Bootstrap:               bootstrap,
			DomainManagementEnabled: h.cfg.DomainManagementEnabled(),
		}, hasSessionCookie(r)
	}

	return models.AuthSessionResponse{
		Authenticated:           true,
		User:                    &user,
		CSRFToken:               session.CSRFToken,
		Bootstrap:               bootstrap,
		DomainManagementEnabled: h.cfg.DomainManagementEnabled(),
	}, false
}

func (h AuthHandler) authenticateRequest(r *http.Request) (models.AuthSession, models.AuthUser, error) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return models.AuthSession{}, models.AuthUser{}, err
	}
	return h.storage.GetSessionByTokenHash(hashSessionToken(cookie.Value))
}

func validateSignupRequest(req signupRequest) error {
	if _, err := normalizeEmailAddress(req.Email); err != nil {
		return err
	}
	passwordBytes := len([]byte(req.Password))
	if passwordBytes < minimumPasswordLength {
		return errors.New("password must be at least 12 characters")
	}
	if passwordBytes > maximumPasswordBytes {
		return errors.New("password must be 72 bytes or fewer")
	}
	if len(strings.TrimSpace(req.Name)) > 120 {
		return errors.New("name must be 120 characters or fewer")
	}
	return nil
}

func buildSessionSecrets() (csrfToken string, sessionToken string, tokenHash string, err error) {
	csrfToken, err = randomToken(32)
	if err != nil {
		return "", "", "", err
	}
	sessionToken, err = randomToken(32)
	if err != nil {
		return "", "", "", err
	}
	return csrfToken, sessionToken, hashSessionToken(sessionToken), nil
}

func randomToken(size int) (string, error) {
	bytes := make([]byte, size)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func hashSessionToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, token string, expiresAt time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   isSecureRequest(r),
		SameSite: http.SameSiteLaxMode,
		Expires:  expiresAt,
		MaxAge:   int(time.Until(expiresAt).Seconds()),
	})
}

func clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   isSecureRequest(r),
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
	})
}

func isSecureRequest(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
}

func requiresCSRFFCheck(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return false
	default:
		return true
	}
}

func subtleCompare(left, right string) int {
	return subtle.ConstantTimeCompare([]byte(strings.TrimSpace(left)), []byte(strings.TrimSpace(right)))
}

func hasSessionCookie(r *http.Request) bool {
	_, err := r.Cookie(sessionCookieName)
	return err == nil
}

func normalizeEmailAddress(raw string) (string, error) {
	addr, err := mail.ParseAddress(strings.TrimSpace(raw))
	if err != nil {
		return "", errors.New("valid email is required")
	}
	return strings.ToLower(strings.TrimSpace(addr.Address)), nil
}
