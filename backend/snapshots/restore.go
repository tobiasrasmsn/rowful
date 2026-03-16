package snapshots

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"rowful/models"
	"rowful/storage"
)

type restorePlan struct {
	root       rootSpec
	stagePath  string
	backupPath string
	present    bool
	isDir      bool
	rootIsDir  bool
}

func (s *Service) Restore(ctx context.Context, runID string) error {
	if strings.TrimSpace(runID) == "" {
		return fmt.Errorf("snapshot run ID is required")
	}

	s.gate.Lock()
	defer s.gate.Unlock()

	s.mu.Lock()
	switch {
	case s.isRunning:
		s.mu.Unlock()
		return fmt.Errorf("wait for the current snapshot run to finish before restoring")
	case s.restoring:
		s.mu.Unlock()
		return fmt.Errorf("another snapshot restore is already in progress")
	default:
		s.restoring = true
		s.mu.Unlock()
	}
	defer func() {
		s.mu.Lock()
		s.restoring = false
		s.mu.Unlock()
	}()

	if err := s.store.DeleteRunningSnapshotRuns(); err != nil {
		return fmt.Errorf("clean snapshot history before restore: %w", err)
	}
	currentRuns, err := s.store.ListSnapshotRuns(50)
	if err != nil {
		return fmt.Errorf("load current snapshot history before restore: %w", err)
	}
	currentSettings, err := s.store.GetSnapshotSettings()
	if err != nil {
		return fmt.Errorf("load current snapshot settings before restore: %w", err)
	}

	settings, err := s.store.GetSnapshotSettings()
	if err != nil {
		return err
	}
	if !settings.IsConfigured() {
		return fmt.Errorf("complete the bucket, access key ID, and secret access key before restoring snapshots")
	}

	run, err := s.store.GetSnapshotRun(runID)
	if err != nil {
		if err == storage.ErrNotFound {
			return fmt.Errorf("snapshot run not found")
		}
		return err
	}
	if run.Status != models.SnapshotStatusSuccess || strings.TrimSpace(run.ObjectKey) == "" {
		return fmt.Errorf("only successful snapshot runs can be restored")
	}

	settings.Region = normalizeSnapshotRegion(settings)

	client, err := s.newClient(ctx, settings)
	if err != nil {
		return err
	}

	archivePath, err := s.downloadSnapshotArchive(ctx, client, settings, run.ObjectKey)
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(archivePath) }()

	plans, err := s.prepareRestorePlans(archivePath)
	if err != nil {
		return err
	}

	if err := s.applyRestore(plans); err != nil {
		return err
	}

	if err := s.store.ReplaceSnapshotSettings(currentSettings); err != nil {
		return fmt.Errorf("restore snapshot settings: %w", err)
	}
	if err := s.store.ReplaceSnapshotRuns(currentRuns); err != nil {
		return fmt.Errorf("restore snapshot run history: %w", err)
	}

	if s.cache != nil {
		s.cache.Clear()
	}

	if currentSettings.Enabled && snapshotSettingsConfigured(currentSettings) && currentSettings.NextRunAt == nil {
		_ = s.ApplySchedule(currentSettings)
	}

	return nil
}

func (s *Service) downloadSnapshotArchive(ctx context.Context, client objectStorageClient, settings models.SnapshotSettings, objectKey string) (string, error) {
	file, err := os.CreateTemp(filepath.Dir(s.cfg.DatabasePath), "rowful-restore-*.zip")
	if err != nil {
		return "", fmt.Errorf("create temporary restore archive: %w", err)
	}
	defer func() {
		_ = file.Close()
	}()

	result, err := client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(settings.Bucket),
		Key:    aws.String(objectKey),
	})
	if err != nil {
		_ = os.Remove(file.Name())
		return "", fmt.Errorf("download snapshot archive: %w", err)
	}
	defer func() { _ = result.Body.Close() }()

	if _, err := io.Copy(file, result.Body); err != nil {
		_ = os.Remove(file.Name())
		return "", fmt.Errorf("write temporary restore archive: %w", err)
	}
	return file.Name(), nil
}

func (s *Service) prepareRestorePlans(archivePath string) ([]restorePlan, error) {
	currentRoots := s.snapshotRoots()
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return nil, fmt.Errorf("open snapshot archive: %w", err)
	}
	defer func() { _ = reader.Close() }()

	manifest, err := readSnapshotManifest(reader.File)
	if err != nil {
		return nil, err
	}

	suffix := fmt.Sprintf("%d", time.Now().UTC().UnixNano())
	plans := make([]restorePlan, 0, len(currentRoots))
	for index, root := range currentRoots {
		stagePath := fmt.Sprintf("%s.rowful-restore-stage-%s-%d", root.Path, suffix, index)
		backupPath := fmt.Sprintf("%s.rowful-restore-backup-%s-%d", root.Path, suffix, index)
		_ = os.RemoveAll(stagePath)
		_ = os.RemoveAll(backupPath)

		present, isDir, err := extractRootToStage(reader.File, root, stagePath)
		if err != nil {
			return nil, err
		}
		if !present && manifestIncludesRoot(manifest, root) && cleanAbsPath(root.Path) == cleanAbsPath(s.cfg.DatabasePath) {
			return nil, fmt.Errorf("snapshot archive is missing the database copy")
		}

		plans = append(plans, restorePlan{
			root:       root,
			stagePath:  stagePath,
			backupPath: backupPath,
			present:    present,
			isDir:      isDir,
			rootIsDir:  rootPathIsDirectory(root.Path, isDir),
		})
	}

	for _, plan := range plans {
		if cleanAbsPath(plan.root.Path) == cleanAbsPath(s.cfg.DatabasePath) && !plan.present {
			return nil, fmt.Errorf("snapshot archive is missing the database copy")
		}
	}

	return plans, nil
}

func (s *Service) applyRestore(plans []restorePlan) error {
	backedUp := make([]restorePlan, 0, len(plans))
	promoted := make([]restorePlan, 0, len(plans))

	cleanupStages := func() {
		for _, plan := range plans {
			_ = os.RemoveAll(plan.stagePath)
		}
	}

	if err := s.store.Close(); err != nil {
		cleanupStages()
		return fmt.Errorf("close live database before restore: %w", err)
	}

	rollback := func(restoreErr error) error {
		for _, plan := range promoted {
			if plan.rootIsDir {
				_ = clearDirectoryContents(plan.root.Path)
			} else {
				_ = os.RemoveAll(plan.root.Path)
			}
		}
		for index := len(backedUp) - 1; index >= 0; index-- {
			plan := backedUp[index]
			var err error
			if plan.rootIsDir {
				err = moveDirectoryContents(plan.backupPath, plan.root.Path)
				if err == nil {
					err = os.RemoveAll(plan.backupPath)
				}
			} else {
				err = os.Rename(plan.backupPath, plan.root.Path)
			}
			if err != nil {
				restoreErr = fmt.Errorf("%w (rollback failed for %s: %v)", restoreErr, plan.root.Path, err)
			}
		}
		if reopenErr := s.store.Reopen(s.cfg.DatabasePath); reopenErr != nil {
			restoreErr = fmt.Errorf("%w (reopen after rollback failed: %v)", restoreErr, reopenErr)
		}
		cleanupStages()
		return restoreErr
	}

	for _, plan := range plans {
		if err := os.MkdirAll(filepath.Dir(plan.root.Path), 0o755); err != nil {
			return rollback(fmt.Errorf("prepare restore parent for %s: %w", plan.root.Path, err))
		}

		if _, err := os.Stat(plan.root.Path); err == nil {
			if plan.rootIsDir {
				if err := moveDirectoryContents(plan.root.Path, plan.backupPath); err != nil {
					return rollback(fmt.Errorf("move live data aside for %s: %w", plan.root.Path, err))
				}
			} else if err := os.Rename(plan.root.Path, plan.backupPath); err != nil {
				return rollback(fmt.Errorf("move live data aside for %s: %w", plan.root.Path, err))
			}
			backedUp = append(backedUp, plan)
		} else if !errors.Is(err, os.ErrNotExist) {
			return rollback(fmt.Errorf("inspect live restore target %s: %w", plan.root.Path, err))
		}

		if cleanAbsPath(plan.root.Path) == cleanAbsPath(s.cfg.DatabasePath) {
			_ = os.Remove(s.cfg.DatabasePath + "-wal")
			_ = os.Remove(s.cfg.DatabasePath + "-shm")
		}
	}

	for _, plan := range plans {
		if !plan.present {
			continue
		}
		var err error
		if plan.rootIsDir {
			err = moveDirectoryContents(plan.stagePath, plan.root.Path)
			if err == nil {
				err = os.RemoveAll(plan.stagePath)
			}
		} else {
			err = os.Rename(plan.stagePath, plan.root.Path)
		}
		if err != nil {
			return rollback(fmt.Errorf("restore snapshot data for %s: %w", plan.root.Path, err))
		}
		promoted = append(promoted, plan)
	}

	if err := s.store.Reopen(s.cfg.DatabasePath); err != nil {
		return rollback(fmt.Errorf("reopen restored database: %w", err))
	}

	for _, plan := range backedUp {
		_ = os.RemoveAll(plan.backupPath)
	}
	cleanupStages()
	return nil
}

func rootPathIsDirectory(rootPath string, stagedAsDirectory bool) bool {
	info, err := os.Stat(rootPath)
	if err == nil {
		return info.IsDir()
	}
	return stagedAsDirectory
}

func moveDirectoryContents(sourceDir, targetDir string) error {
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return fmt.Errorf("create directory %s: %w", targetDir, err)
	}

	entries, err := os.ReadDir(sourceDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("read directory %s: %w", sourceDir, err)
	}

	for _, entry := range entries {
		sourcePath := filepath.Join(sourceDir, entry.Name())
		targetPath := filepath.Join(targetDir, entry.Name())
		_ = os.RemoveAll(targetPath)
		if err := os.Rename(sourcePath, targetPath); err != nil {
			return fmt.Errorf("move %s to %s: %w", sourcePath, targetPath, err)
		}
	}
	return nil
}

func clearDirectoryContents(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	for _, entry := range entries {
		if err := os.RemoveAll(filepath.Join(dir, entry.Name())); err != nil {
			return err
		}
	}
	return nil
}

func readSnapshotManifest(files []*zip.File) (snapshotManifest, error) {
	for _, file := range files {
		if strings.TrimSpace(file.Name) != "manifest.json" {
			continue
		}

		reader, err := file.Open()
		if err != nil {
			return snapshotManifest{}, fmt.Errorf("open snapshot manifest: %w", err)
		}
		defer func() { _ = reader.Close() }()

		var manifest snapshotManifest
		if err := json.NewDecoder(reader).Decode(&manifest); err != nil {
			return snapshotManifest{}, fmt.Errorf("decode snapshot manifest: %w", err)
		}
		return manifest, nil
	}
	return snapshotManifest{}, nil
}

func extractRootToStage(files []*zip.File, root rootSpec, stagePath string) (bool, bool, error) {
	prefix := strings.Trim(filepath.ToSlash(root.ArchiveAs), "/")
	if prefix == "" {
		return false, false, nil
	}

	var matched []*zip.File
	isDir := false
	for _, file := range files {
		name := strings.Trim(filepath.ToSlash(file.Name), "/")
		switch {
		case name == prefix:
			matched = append(matched, file)
		case strings.HasPrefix(name, prefix+"/"):
			matched = append(matched, file)
			isDir = true
		}
	}
	if len(matched) == 0 {
		return false, false, nil
	}

	if !isDir {
		if err := extractZipFile(matched[0], stagePath); err != nil {
			return false, false, err
		}
		return true, false, nil
	}

	if err := os.MkdirAll(stagePath, 0o755); err != nil {
		return false, false, fmt.Errorf("create restore staging directory for %s: %w", root.Path, err)
	}

	for _, file := range matched {
		name := strings.Trim(filepath.ToSlash(file.Name), "/")
		if name == prefix {
			continue
		}
		relative := strings.TrimPrefix(name, prefix+"/")
		if relative == "" {
			continue
		}
		cleanRelative := path.Clean(relative)
		if cleanRelative == "." || cleanRelative == ".." || strings.HasPrefix(cleanRelative, "../") {
			return false, false, fmt.Errorf("snapshot archive contains an invalid path: %s", file.Name)
		}
		destination := filepath.Join(stagePath, filepath.FromSlash(cleanRelative))
		if err := extractZipFile(file, destination); err != nil {
			return false, false, err
		}
	}

	return true, true, nil
}

func extractZipFile(file *zip.File, destination string) error {
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return fmt.Errorf("prepare restore path %s: %w", destination, err)
	}

	reader, err := file.Open()
	if err != nil {
		return fmt.Errorf("open snapshot archive entry %s: %w", file.Name, err)
	}
	defer func() { _ = reader.Close() }()

	mode := file.Mode()
	if mode == 0 {
		mode = 0o644
	}

	output, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return fmt.Errorf("create restore file %s: %w", destination, err)
	}
	defer func() { _ = output.Close() }()

	if _, err := io.Copy(output, reader); err != nil {
		return fmt.Errorf("write restore file %s: %w", destination, err)
	}
	return nil
}

func manifestIncludesRoot(manifest snapshotManifest, root rootSpec) bool {
	rootPath := cleanAbsPath(root.Path)
	for _, item := range manifest.Roots {
		if cleanAbsPath(item.Path) == rootPath {
			return true
		}
	}
	for _, target := range manifest.Targets {
		if cleanAbsPath(target) == rootPath {
			return true
		}
	}
	return false
}

func buildManifestRoots(roots []rootSpec) []snapshotManifestRoot {
	manifestRoots := make([]snapshotManifestRoot, 0, len(roots))
	for _, root := range roots {
		manifestRoots = append(manifestRoots, snapshotManifestRoot{
			Path:      root.Path,
			ArchiveAs: root.ArchiveAs,
		})
	}
	return manifestRoots
}

func normalizeSnapshotRegion(settings models.SnapshotSettings) string {
	if strings.TrimSpace(settings.Region) != "" {
		return strings.TrimSpace(settings.Region)
	}
	if strings.TrimSpace(settings.Endpoint) != "" {
		return "auto"
	}
	return "us-east-1"
}
