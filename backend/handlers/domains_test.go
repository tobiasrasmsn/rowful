package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"rowful/config"
	"rowful/models"
)

func TestCreateReturnsServiceUnavailableWhenCaddyIsDisabled(t *testing.T) {
	handler := NewDomainsHandler(config.Config{
		PublicIPs: []string{"127.0.0.1"},
	}, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/domains", strings.NewReader(`{"domain":"example.com"}`))
	rec := httptest.NewRecorder()

	handler.Create(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status %d, got %d", http.StatusServiceUnavailable, rec.Code)
	}

	var resp models.ErrorResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if !strings.Contains(resp.Error, "Caddy") {
		t.Fatalf("expected error mentioning Caddy, got %q", resp.Error)
	}
}

func TestListReturnsServiceUnavailableWhenCaddyIsDisabled(t *testing.T) {
	handler := NewDomainsHandler(config.Config{}, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/domains", nil)
	rec := httptest.NewRecorder()

	handler.List(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status %d, got %d", http.StatusServiceUnavailable, rec.Code)
	}
}
