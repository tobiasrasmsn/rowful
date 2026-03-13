package storage

import (
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

	secondUser, err := store.CreateUser("Second User", "second@example.com", string(secondPassword))
	if err != nil {
		t.Fatalf("create second user: %v", err)
	}
	if secondUser.IsAdmin {
		t.Fatalf("expected second user to not be admin")
	}

	bootstrap, err := store.GetBootstrapState()
	if err != nil {
		t.Fatalf("load bootstrap state: %v", err)
	}
	if bootstrap.SetupRequired {
		t.Fatalf("expected bootstrap setup to be complete after creating users")
	}
	if bootstrap.InviteOnly {
		t.Fatalf("expected signup to remain open after bootstrap")
	}
}
