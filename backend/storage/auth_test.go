package storage

import (
	"errors"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestCreateUserAssignsAdminOnlyToFirstSignup(t *testing.T) {
	store, err := New(t.TempDir()+"/rowful.db", "test-app-encryption-key-1234567890")
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	t.Cleanup(func() {
		if store.db != nil {
			_ = store.db.Close()
		}
	})

	firstPassword, err := bcrypt.GenerateFromPassword([]byte("first-password-123"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("hash first password: %v", err)
	}
	secondPassword, err := bcrypt.GenerateFromPassword([]byte("second-password-123"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("hash second password: %v", err)
	}

	firstUser, err := store.CreateUser("First User", "first@example.com", string(firstPassword))
	if err != nil {
		t.Fatalf("create first user: %v", err)
	}
	if !firstUser.IsAdmin {
		t.Fatalf("expected first user to be admin")
	}

	bootstrap, err := store.GetBootstrapState()
	if err != nil {
		t.Fatalf("load bootstrap state: %v", err)
	}
	if bootstrap.SetupRequired {
		t.Fatalf("expected bootstrap setup to be complete after creating first user")
	}
	if bootstrap.SignupsEnabled {
		t.Fatalf("expected signup to be disabled by default after bootstrap")
	}
	if bootstrap.InviteOnly {
		t.Fatalf("expected whitelist mode to be disabled by default")
	}

	bootstrap, err = store.UpdateSignupPolicy(true, false)
	if err != nil {
		t.Fatalf("enable signup policy: %v", err)
	}
	if !bootstrap.SignupsEnabled {
		t.Fatalf("expected signup policy to be enabled")
	}
	if bootstrap.InviteOnly {
		t.Fatalf("expected whitelist mode to stay disabled")
	}

	secondUser, err := store.CreateUser("Second User", "second@example.com", string(secondPassword))
	if err != nil {
		t.Fatalf("create second user: %v", err)
	}
	if secondUser.IsAdmin {
		t.Fatalf("expected second user to not be admin")
	}

	bootstrap, err = store.GetBootstrapState()
	if err != nil {
		t.Fatalf("load bootstrap state: %v", err)
	}
	if bootstrap.SetupRequired {
		t.Fatalf("expected bootstrap setup to be complete after creating users")
	}
	if !bootstrap.SignupsEnabled {
		t.Fatalf("expected signup policy to remain enabled")
	}
}

func TestCreateUserRejectsSignupWhenDisabledAfterBootstrap(t *testing.T) {
	store, err := New(t.TempDir()+"/rowful.db", "test-app-encryption-key-1234567890")
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	t.Cleanup(func() {
		if store.db != nil {
			_ = store.db.Close()
		}
	})

	adminPassword, err := bcrypt.GenerateFromPassword([]byte("admin-password-123"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("hash admin password: %v", err)
	}
	memberPassword, err := bcrypt.GenerateFromPassword([]byte("member-password-123"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("hash member password: %v", err)
	}

	if _, err := store.CreateUser("Admin", "admin@example.com", string(adminPassword)); err != nil {
		t.Fatalf("create admin user: %v", err)
	}

	_, err = store.CreateUser("Member", "member@example.com", string(memberPassword))
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected signup to be forbidden, got %v", err)
	}
}

func TestCreateUserAllowsWhitelistedSignupWhenInviteOnly(t *testing.T) {
	store, err := New(t.TempDir()+"/rowful.db", "test-app-encryption-key-1234567890")
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	t.Cleanup(func() {
		if store.db != nil {
			_ = store.db.Close()
		}
	})

	adminPassword, err := bcrypt.GenerateFromPassword([]byte("admin-password-123"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("hash admin password: %v", err)
	}
	memberPassword, err := bcrypt.GenerateFromPassword([]byte("member-password-123"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("hash member password: %v", err)
	}

	adminUser, err := store.CreateUser("Admin", "admin@example.com", string(adminPassword))
	if err != nil {
		t.Fatalf("create admin user: %v", err)
	}

	if _, err := store.AddAllowlistEntry("member@example.com", adminUser.ID); err != nil {
		t.Fatalf("add allowlist entry: %v", err)
	}
	bootstrap, err := store.UpdateSignupPolicy(true, true)
	if err != nil {
		t.Fatalf("enable whitelist mode: %v", err)
	}
	if !bootstrap.SignupsEnabled || !bootstrap.InviteOnly {
		t.Fatalf("expected whitelist signup mode to be enabled")
	}

	memberUser, err := store.CreateUser("Member", "member@example.com", string(memberPassword))
	if err != nil {
		t.Fatalf("create whitelisted member: %v", err)
	}
	if memberUser.IsAdmin {
		t.Fatalf("expected whitelisted member to not be admin")
	}

	entries, err := store.ListAllowlistEntries()
	if err != nil {
		t.Fatalf("list allowlist entries: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 allowlist entry, got %d", len(entries))
	}
	if entries[0].ClaimedAt == nil {
		t.Fatalf("expected allowlist entry to be claimed")
	}
	if entries[0].ClaimedByEmail != "member@example.com" {
		t.Fatalf("expected allowlist entry to be claimed by member@example.com, got %q", entries[0].ClaimedByEmail)
	}
}
