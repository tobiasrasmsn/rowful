package storage

import "testing"

func TestCreateFolderAllowsRootFolders(t *testing.T) {
	store := newTestStore(t)

	user, err := store.CreateUser("Test User", "folders@example.com", "hash")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	folder, err := store.CreateFolder(user.ID, "Projects", "")
	if err != nil {
		t.Fatalf("create root folder: %v", err)
	}
	if folder.ParentID != "" {
		t.Fatalf("expected root folder parent to be empty, got %q", folder.ParentID)
	}

	folders, err := store.ListFoldersForUser(user.ID)
	if err != nil {
		t.Fatalf("list folders: %v", err)
	}
	if len(folders) != 1 {
		t.Fatalf("expected 1 folder, got %d", len(folders))
	}
	if folders[0].Name != "Projects" {
		t.Fatalf("expected folder name Projects, got %q", folders[0].Name)
	}
	if folders[0].ParentID != "" {
		t.Fatalf("expected listed root folder parent to be empty, got %q", folders[0].ParentID)
	}
}
