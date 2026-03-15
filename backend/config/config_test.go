package config

import (
	"os"
	"testing"
)

func TestLoadDisablesCaddyWhenAdminURLUnset(t *testing.T) {
	t.Setenv("CADDY_ADMIN_URL", "")
	if err := os.Unsetenv("CADDY_ADMIN_URL"); err != nil {
		t.Fatalf("unset CADDY_ADMIN_URL: %v", err)
	}

	cfg := Load()
	if cfg.CaddyAdminURL != "" {
		t.Fatalf("expected empty CaddyAdminURL when unset, got %q", cfg.CaddyAdminURL)
	}
}

func TestLoadPreservesExplicitEmptyCaddyAdminURL(t *testing.T) {
	t.Setenv("CADDY_ADMIN_URL", "   ")

	cfg := Load()
	if cfg.CaddyAdminURL != "" {
		t.Fatalf("expected empty CaddyAdminURL when explicitly blank, got %q", cfg.CaddyAdminURL)
	}
}
