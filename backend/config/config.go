package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port             string
	MaxFileSizeBytes int64
	AllowedOrigins   []string
	DatabasePath     string
	UploadDir        string
	ReadTimeout      time.Duration
	WriteTimeout     time.Duration
	IdleTimeout      time.Duration
}

func Load() Config {
	port := getEnv("PORT", "8080")
	maxMB := getEnvInt64("MAX_FILE_SIZE_MB", 25)
	allowedOrigins := splitCSV(getEnv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"))

	return Config{
		Port:             port,
		MaxFileSizeBytes: maxMB * 1024 * 1024,
		AllowedOrigins:   allowedOrigins,
		DatabasePath:     getEnv("DB_PATH", "./planar.db"),
		UploadDir:        getEnv("UPLOAD_DIR", "./uploads"),
		ReadTimeout:      getEnvDuration("READ_TIMEOUT", 30*time.Second),
		WriteTimeout:     getEnvDuration("WRITE_TIMEOUT", 30*time.Second),
		IdleTimeout:      getEnvDuration("IDLE_TIMEOUT", 60*time.Second),
	}
}

func getEnv(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func getEnvInt64(key string, fallback int64) int64 {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func getEnvDuration(key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	origins := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			origins = append(origins, trimmed)
		}
	}
	if len(origins) == 0 {
		return []string{"http://localhost:5173", "http://127.0.0.1:5173"}
	}
	return origins
}
