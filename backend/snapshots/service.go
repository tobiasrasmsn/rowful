package snapshots

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"

	"rowful/appstate"
	"rowful/cache"
	"rowful/config"
	"rowful/models"
	"rowful/storage"
)

const schedulerTickInterval = time.Minute

type objectStorageClient interface {
	PutObject(context.Context, *s3.PutObjectInput, ...func(*s3.Options)) (*s3.PutObjectOutput, error)
	ListObjectsV2(context.Context, *s3.ListObjectsV2Input, ...func(*s3.Options)) (*s3.ListObjectsV2Output, error)
	DeleteObject(context.Context, *s3.DeleteObjectInput, ...func(*s3.Options)) (*s3.DeleteObjectOutput, error)
	GetObject(context.Context, *s3.GetObjectInput, ...func(*s3.Options)) (*s3.GetObjectOutput, error)
}

type Service struct {
	cfg       config.Config
	store     *storage.Store
	cache     *cache.Store
	gate      *appstate.DataGate
	newClient func(context.Context, models.SnapshotSettings) (objectStorageClient, error)
	mu        sync.Mutex
	isRunning bool
	restoring bool
}

type snapshotManifest struct {
	CreatedAt string                 `json:"createdAt"`
	Targets   []string               `json:"targets"`
	Roots     []snapshotManifestRoot `json:"roots,omitempty"`
}

type snapshotManifestRoot struct {
	Path      string `json:"path"`
	ArchiveAs string `json:"archiveAs"`
}

type archiveBuild struct {
	path      string
	sizeBytes int64
	objectKey string
	cleanup   func()
}

type rootSpec struct {
	Path      string
	ArchiveAs string
}

func NewService(cfg config.Config, store *storage.Store, cacheStore *cache.Store, gate *appstate.DataGate) *Service {
	return &Service{
		cfg:       cfg,
		store:     store,
		cache:     cacheStore,
		gate:      gate,
		newClient: newS3Client,
	}
}

func (s *Service) Start(ctx context.Context) {
	if err := s.store.MarkRunningSnapshotRunsFailed("snapshot worker restarted before the previous run completed"); err != nil {
		log.Printf("snapshot scheduler: failed to repair prior runs: %v", err)
	}

	go s.runScheduler(ctx)
}

func (s *Service) runScheduler(ctx context.Context) {
	s.tick(ctx)

	ticker := time.NewTicker(schedulerTickInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.tick(ctx)
		}
	}
}

func (s *Service) tick(ctx context.Context) {
	s.gate.RLock()
	defer s.gate.RUnlock()

	settings, err := s.store.GetSnapshotSettings()
	if err != nil {
		log.Printf("snapshot scheduler: failed to load settings: %v", err)
		return
	}
	if !settings.Enabled || !settings.IsConfigured() {
		return
	}

	now := time.Now().UTC()
	if settings.NextRunAt == nil {
		nextRun := now.Add(time.Duration(settings.ScheduleIntervalHours) * time.Hour)
		if err := s.store.UpdateSnapshotSchedule(&nextRun); err != nil {
			log.Printf("snapshot scheduler: failed to seed next run: %v", err)
		}
		return
	}
	if settings.NextRunAt.After(now) {
		return
	}

	if _, started, triggerErr := s.Trigger(ctx, models.SnapshotTriggerScheduled); triggerErr != nil {
		log.Printf("snapshot scheduler: failed to start snapshot: %v", triggerErr)
	} else if started {
		log.Printf("snapshot scheduler: started scheduled snapshot")
	}
}

func (s *Service) Trigger(ctx context.Context, trigger string) (models.SnapshotRun, bool, error) {
	s.gate.RLock()
	defer s.gate.RUnlock()

	settings, err := s.store.GetSnapshotSettings()
	if err != nil {
		return models.SnapshotRun{}, false, err
	}
	if !settings.IsConfigured() {
		return models.SnapshotRun{}, false, fmt.Errorf("complete the bucket, access key ID, and secret access key before running snapshots")
	}

	s.mu.Lock()
	if s.isRunning {
		s.mu.Unlock()
		runs, listErr := s.store.ListSnapshotRuns(1)
		if listErr == nil && len(runs) > 0 {
			return runs[0], false, nil
		}
		return models.SnapshotRun{}, false, nil
	}
	if s.restoring {
		s.mu.Unlock()
		return models.SnapshotRun{}, false, fmt.Errorf("snapshot restore is currently in progress")
	}
	s.isRunning = true
	s.mu.Unlock()

	run, err := s.store.CreateSnapshotRun(trigger)
	if err != nil {
		s.mu.Lock()
		s.isRunning = false
		s.mu.Unlock()
		return models.SnapshotRun{}, false, err
	}

	go s.execute(context.WithoutCancel(ctx), run, settings)
	return run, true, nil
}

func (s *Service) IsRunning() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.isRunning
}

func (s *Service) IsRestoring() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.restoring
}

func (s *Service) Targets() []string {
	specs := s.snapshotRoots()
	targets := make([]string, 0, len(specs))
	for _, spec := range specs {
		targets = append(targets, spec.Path)
	}
	return targets
}

func (s *Service) ApplySchedule(settings models.SnapshotSettings) error {
	if !settings.Enabled || !settings.IsConfigured() {
		return s.store.UpdateSnapshotSchedule(nil)
	}

	nextRun := time.Now().UTC().Add(time.Duration(settings.ScheduleIntervalHours) * time.Hour)
	return s.store.UpdateSnapshotSchedule(&nextRun)
}

func (s *Service) execute(ctx context.Context, run models.SnapshotRun, settings models.SnapshotSettings) {
	s.gate.RLock()
	defer s.gate.RUnlock()

	defer func() {
		s.mu.Lock()
		s.isRunning = false
		s.mu.Unlock()
	}()

	completedAt := time.Now().UTC()
	if settings.Region == "" {
		if settings.Endpoint != "" {
			settings.Region = "auto"
		} else {
			settings.Region = "us-east-1"
		}
	}

	build, err := s.buildArchive(settings)
	if err == nil {
		defer build.cleanup()
	}

	if err == nil {
		var client objectStorageClient
		client, err = s.newClient(ctx, settings)
		if err == nil {
			err = uploadObject(ctx, client, settings, build)
		}
		if err == nil {
			err = pruneOldSnapshots(ctx, client, settings)
		}
	}

	completedAt = time.Now().UTC()
	run.CompletedAt = &completedAt
	nextRun := s.computeNextRun(settings, completedAt)

	if err != nil {
		run.Status = models.SnapshotStatusFailed
		run.Error = err.Error()
		if finalizeErr := s.store.FinalizeSnapshotRun(run, nextRun); finalizeErr != nil {
			log.Printf("snapshot worker: failed to persist failed run: %v", finalizeErr)
		}
		log.Printf("snapshot worker: snapshot failed: %v", err)
		return
	}

	run.Status = models.SnapshotStatusSuccess
	run.ObjectKey = build.objectKey
	run.SizeBytes = build.sizeBytes
	if finalizeErr := s.store.FinalizeSnapshotRun(run, nextRun); finalizeErr != nil {
		log.Printf("snapshot worker: failed to persist successful run: %v", finalizeErr)
	}
	log.Printf("snapshot worker: uploaded snapshot %s (%d bytes)", build.objectKey, build.sizeBytes)
}

func (s *Service) computeNextRun(settings models.SnapshotSettings, completedAt time.Time) *time.Time {
	if !settings.Enabled || settings.ScheduleIntervalHours <= 0 {
		return nil
	}
	if settings.NextRunAt != nil && settings.NextRunAt.After(completedAt) {
		return settings.NextRunAt
	}
	next := completedAt.Add(time.Duration(settings.ScheduleIntervalHours) * time.Hour)
	return &next
}

func (s *Service) buildArchive(settings models.SnapshotSettings) (archiveBuild, error) {
	tempDir := filepath.Dir(s.cfg.DatabasePath)
	if tempDir == "" {
		tempDir = "."
	}

	archiveFile, err := os.CreateTemp(tempDir, "rowful-snapshot-*.zip")
	if err != nil {
		return archiveBuild{}, fmt.Errorf("create temporary archive: %w", err)
	}
	archivePath := archiveFile.Name()
	cleanup := func() {
		_ = os.Remove(archivePath)
	}

	defer func() {
		_ = archiveFile.Close()
	}()

	mainDBCopyPath, err := s.createSQLiteSnapshot(tempDir)
	if err != nil {
		cleanup()
		return archiveBuild{}, err
	}
	defer func() { _ = os.Remove(mainDBCopyPath) }()

	zipWriter := zip.NewWriter(archiveFile)
	manifest := snapshotManifest{
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Targets:   s.Targets(),
		Roots:     buildManifestRoots(s.snapshotRoots()),
	}
	if err := addJSONFile(zipWriter, "manifest.json", manifest); err != nil {
		_ = zipWriter.Close()
		cleanup()
		return archiveBuild{}, err
	}

	mainDBAbsolute, _ := filepath.Abs(s.cfg.DatabasePath)
	rootSpecs := s.snapshotRoots()
	for _, root := range rootSpecs {
		info, statErr := os.Stat(root.Path)
		if statErr != nil {
			if errors.Is(statErr, os.ErrNotExist) {
				continue
			}
			_ = zipWriter.Close()
			cleanup()
			return archiveBuild{}, fmt.Errorf("inspect snapshot target %s: %w", root.Path, statErr)
		}

		if info.IsDir() {
			if err := addDirectory(zipWriter, root, mainDBAbsolute, mainDBCopyPath); err != nil {
				_ = zipWriter.Close()
				cleanup()
				return archiveBuild{}, err
			}
			continue
		}
		sourcePath := root.Path
		if cleanAbsPath(root.Path) == mainDBAbsolute {
			sourcePath = mainDBCopyPath
		}
		if err := addFile(zipWriter, root.ArchiveAs, sourcePath); err != nil {
			_ = zipWriter.Close()
			cleanup()
			return archiveBuild{}, err
		}
	}

	if err := zipWriter.Close(); err != nil {
		cleanup()
		return archiveBuild{}, fmt.Errorf("finalize snapshot archive: %w", err)
	}

	info, err := os.Stat(archivePath)
	if err != nil {
		cleanup()
		return archiveBuild{}, fmt.Errorf("stat snapshot archive: %w", err)
	}

	objectKey := buildObjectKey(settings.Prefix, time.Now().UTC())
	return archiveBuild{
		path:      archivePath,
		sizeBytes: info.Size(),
		objectKey: objectKey,
		cleanup:   cleanup,
	}, nil
}

func (s *Service) createSQLiteSnapshot(tempDir string) (string, error) {
	tempFile, err := os.CreateTemp(tempDir, "rowful-sqlite-*.db")
	if err != nil {
		return "", fmt.Errorf("create sqlite snapshot temp file: %w", err)
	}
	path := tempFile.Name()
	_ = tempFile.Close()
	_ = os.Remove(path)

	if _, err := s.store.DB().Exec(fmt.Sprintf("VACUUM INTO %s", sqliteStringLiteral(path))); err != nil {
		return "", fmt.Errorf("create consistent sqlite snapshot: %w", err)
	}
	return path, nil
}

func (s *Service) snapshotRoots() []rootSpec {
	dbPath := cleanAbsPath(s.cfg.DatabasePath)
	uploadPath := cleanAbsPath(s.cfg.UploadDir)

	var roots []rootSpec
	dbDir := filepath.Dir(dbPath)
	if filepath.IsAbs(s.cfg.DatabasePath) && filepath.IsAbs(s.cfg.UploadDir) && isSubpath(uploadPath, dbDir) && dbDir != "/" {
		roots = append(roots, rootSpec{Path: dbDir, ArchiveAs: labelForRoot(dbDir)})
	} else {
		roots = append(roots, rootSpec{Path: dbPath, ArchiveAs: filepath.Join("database", filepath.Base(dbPath))})
		if uploadPath != "" {
			roots = append(roots, rootSpec{Path: uploadPath, ArchiveAs: filepath.Join("uploads", filepath.Base(uploadPath))})
		}
	}

	if caddyRoot := s.detectCaddyRoot(); caddyRoot != "" {
		roots = append(roots, rootSpec{Path: caddyRoot, ArchiveAs: labelForRoot(caddyRoot)})
	}
	return dedupeRoots(roots)
}

func (s *Service) detectCaddyRoot() string {
	if strings.TrimSpace(s.cfg.CaddyConfigPath) == "" && strings.TrimSpace(s.cfg.CaddySitesPath) == "" {
		return ""
	}

	candidates := []string{
		filepath.Dir(strings.TrimSpace(s.cfg.CaddyConfigPath)),
		strings.TrimSpace(s.cfg.CaddySitesPath),
	}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		abs := cleanAbsPath(candidate)
		if info, err := os.Stat(abs); err == nil && info.IsDir() {
			return abs
		}
	}
	return ""
}

func newS3Client(ctx context.Context, settings models.SnapshotSettings) (objectStorageClient, error) {
	loadOptions := []func(*awsconfig.LoadOptions) error{
		awsconfig.WithRegion(settings.Region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(settings.AccessKeyID, settings.SecretAccessKey, "")),
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx, loadOptions...)
	if err != nil {
		return nil, fmt.Errorf("load s3 client config: %w", err)
	}

	return s3.NewFromConfig(cfg, func(options *s3.Options) {
		options.UsePathStyle = settings.UsePathStyle
		if settings.Endpoint != "" {
			options.BaseEndpoint = aws.String(settings.Endpoint)
		}
	}), nil
}

func uploadObject(ctx context.Context, client objectStorageClient, settings models.SnapshotSettings, build archiveBuild) error {
	file, err := os.Open(build.path)
	if err != nil {
		return fmt.Errorf("open snapshot archive for upload: %w", err)
	}
	defer func() { _ = file.Close() }()

	if _, err := client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(settings.Bucket),
		Key:           aws.String(build.objectKey),
		Body:          file,
		ContentType:   aws.String("application/zip"),
		ContentLength: aws.Int64(build.sizeBytes),
		Metadata: map[string]string{
			"snapshot-kind": "rowful",
		},
	}); err != nil {
		return fmt.Errorf("upload snapshot to object storage: %w", err)
	}
	return nil
}

func pruneOldSnapshots(ctx context.Context, client objectStorageClient, settings models.SnapshotSettings) error {
	if settings.RetentionCount <= 0 {
		return nil
	}

	prefix := settings.Prefix
	if prefix != "" {
		prefix += "/"
	}

	var objects []types.Object
	var continuation *string
	for {
		result, err := client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
			Bucket:            aws.String(settings.Bucket),
			Prefix:            aws.String(prefix),
			ContinuationToken: continuation,
		})
		if err != nil {
			return fmt.Errorf("list existing snapshots: %w", err)
		}

		for _, object := range result.Contents {
			key := aws.ToString(object.Key)
			if key == "" || !strings.HasSuffix(key, ".zip") {
				continue
			}
			objects = append(objects, object)
		}

		if !aws.ToBool(result.IsTruncated) {
			break
		}
		continuation = result.NextContinuationToken
	}

	sort.Slice(objects, func(i, j int) bool {
		left := time.Time{}
		right := time.Time{}
		if objects[i].LastModified != nil {
			left = *objects[i].LastModified
		}
		if objects[j].LastModified != nil {
			right = *objects[j].LastModified
		}
		return left.After(right)
	})

	for index, object := range objects {
		if index < settings.RetentionCount {
			continue
		}
		if _, err := client.DeleteObject(ctx, &s3.DeleteObjectInput{
			Bucket: aws.String(settings.Bucket),
			Key:    object.Key,
		}); err != nil {
			return fmt.Errorf("delete old snapshot %s: %w", aws.ToString(object.Key), err)
		}
	}
	return nil
}

func addJSONFile(zipWriter *zip.Writer, name string, payload any) error {
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal snapshot manifest: %w", err)
	}
	return addBytes(zipWriter, name, data)
}

func addDirectory(zipWriter *zip.Writer, root rootSpec, mainDBPath, mainDBCopyPath string) error {
	return filepath.WalkDir(root.Path, func(currentPath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return nil
		}

		absolutePath := cleanAbsPath(currentPath)
		relativePath, err := filepath.Rel(root.Path, currentPath)
		if err != nil {
			return fmt.Errorf("build relative path for %s: %w", currentPath, err)
		}
		archivePath := filepath.ToSlash(filepath.Join(root.ArchiveAs, relativePath))

		switch {
		case absolutePath == mainDBPath:
			return addFile(zipWriter, archivePath, mainDBCopyPath)
		case absolutePath == mainDBPath+"-wal", absolutePath == mainDBPath+"-shm":
			return nil
		default:
			return addFile(zipWriter, archivePath, currentPath)
		}
	})
}

func addFile(zipWriter *zip.Writer, archivePath, sourcePath string) error {
	fileInfo, err := os.Stat(sourcePath)
	if err != nil {
		return fmt.Errorf("stat %s: %w", sourcePath, err)
	}

	header, err := zip.FileInfoHeader(fileInfo)
	if err != nil {
		return fmt.Errorf("create zip header for %s: %w", sourcePath, err)
	}
	header.Name = filepath.ToSlash(archivePath)
	header.Method = zip.Deflate

	writer, err := zipWriter.CreateHeader(header)
	if err != nil {
		return fmt.Errorf("create archive entry for %s: %w", sourcePath, err)
	}

	file, err := os.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("open %s: %w", sourcePath, err)
	}
	defer func() { _ = file.Close() }()

	if _, err := io.Copy(writer, file); err != nil {
		return fmt.Errorf("write %s to archive: %w", sourcePath, err)
	}
	return nil
}

func addBytes(zipWriter *zip.Writer, archivePath string, data []byte) error {
	writer, err := zipWriter.Create(filepath.ToSlash(archivePath))
	if err != nil {
		return fmt.Errorf("create archive entry %s: %w", archivePath, err)
	}
	if _, err := io.Copy(writer, bytes.NewReader(data)); err != nil {
		return fmt.Errorf("write archive entry %s: %w", archivePath, err)
	}
	return nil
}

func buildObjectKey(prefix string, now time.Time) string {
	fileName := fmt.Sprintf("rowful-snapshot-%s.zip", now.UTC().Format("20060102T150405Z"))
	if prefix == "" {
		return fileName
	}
	return prefix + "/" + fileName
}

func dedupeRoots(roots []rootSpec) []rootSpec {
	filtered := make([]rootSpec, 0, len(roots))
	for _, root := range roots {
		if strings.TrimSpace(root.Path) == "" {
			continue
		}
		filtered = append(filtered, rootSpec{
			Path:      cleanAbsPath(root.Path),
			ArchiveAs: filepath.ToSlash(root.ArchiveAs),
		})
	}

	sort.Slice(filtered, func(i, j int) bool {
		return len(filtered[i].Path) < len(filtered[j].Path)
	})

	result := make([]rootSpec, 0, len(filtered))
	for _, root := range filtered {
		skip := false
		for _, existing := range result {
			if root.Path == existing.Path || isSubpath(root.Path, existing.Path) {
				skip = true
				break
			}
		}
		if !skip {
			result = append(result, root)
		}
	}
	return result
}

func cleanAbsPath(path string) string {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return ""
	}
	absolute, err := filepath.Abs(trimmed)
	if err != nil {
		return filepath.Clean(trimmed)
	}
	return filepath.Clean(absolute)
}

func labelForRoot(path string) string {
	label := strings.Trim(filepath.ToSlash(strings.TrimSpace(path)), "/")
	label = strings.ReplaceAll(label, "/", "-")
	if label == "" {
		return "root"
	}
	return label
}

func isSubpath(child, parent string) bool {
	if child == "" || parent == "" || child == parent {
		return child == parent
	}
	relative, err := filepath.Rel(parent, child)
	if err != nil {
		return false
	}
	return relative != "." && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func sqliteStringLiteral(path string) string {
	return "'" + strings.ReplaceAll(path, "'", "''") + "'"
}
