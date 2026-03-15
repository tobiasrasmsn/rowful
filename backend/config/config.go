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
	AppEncryptionKey string
	PublicIPs        []string
	CaddyAdminURL    string
	CaddyConfigPath  string
	CaddySitesPath   string
	ReadTimeout      time.Duration
	WriteTimeout     time.Duration
	IdleTimeout      time.Duration
}

func (c Config) DomainManagementEnabled() bool {
	return strings.TrimSpace(c.CaddyAdminURL) != "" &&
		strings.TrimSpace(c.CaddyConfigPath) != "" &&
		strings.TrimSpace(c.CaddySitesPath) != ""
}

func Load() Config {
	port := getEnv("PORT", "8080")
	maxMB := getEnvInt64("MAX_FILE_SIZE_MB", 25)
	allowedOrigins := splitCSV(getEnv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"))

	return Config{
		Port:             port,
		MaxFileSizeBytes: maxMB * 1024 * 1024,
		AllowedOrigins:   allowedOrigins,
		DatabasePath:     getEnv("DB_PATH", "./rowful.db"),
		UploadDir:        getEnv("UPLOAD_DIR", "./uploads"),
		AppEncryptionKey: strings.TrimSpace(os.Getenv("APP_ENCRYPTION_KEY")),
		PublicIPs:        loadPublicIPs(),
		CaddyAdminURL:    getEnvAllowEmpty("CADDY_ADMIN_URL", ""),
		CaddyConfigPath:  getEnv("CADDY_CONFIG_PATH", "/etc/caddy/Caddyfile"),
		CaddySitesPath:   getEnv("CADDY_SITES_PATH", "/etc/caddy/sites"),
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

func getEnvAllowEmpty(key, fallback string) string {
	value, ok := os.LookupEnv(key)
	if !ok {
		return fallback
	}
	return strings.TrimSpace(value)
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

func loadPublicIPs() []string {
	if ips := splitOptionalCSV(os.Getenv("PUBLIC_IPS")); len(ips) > 0 {
		return ips
	}
	ip := strings.TrimSpace(os.Getenv("PUBLIC_IP"))
	if ip == "" {
		return nil
	}
	return []string{ip}
}

func splitOptionalCSV(value string) []string {
	parts := strings.Split(value, ",")
	items := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			items = append(items, trimmed)
		}
	}
	return items
}
