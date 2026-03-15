package handlers

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"

	"rowful/config"
	"rowful/models"
	"rowful/storage"
)

var domainPattern = regexp.MustCompile(`^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$`)

type DomainsHandler struct {
	cfg     config.Config
	storage *storage.Store
	client  *http.Client
}

type manageDomainRequest struct {
	Domain string `json:"domain"`
}

type caddyAdaptResponse struct {
	Result json.RawMessage `json:"result"`
}

var errCaddyUnavailable = errors.New("custom domain provisioning is unavailable because Caddy is not configured")

func NewDomainsHandler(cfg config.Config, storageStore *storage.Store) DomainsHandler {
	return DomainsHandler{
		cfg:     cfg,
		storage: storageStore,
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

func (h DomainsHandler) List(w http.ResponseWriter, _ *http.Request) {
	domains, err := h.storage.ListManagedDomains()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load managed domains"})
		return
	}
	writeJSON(w, http.StatusOK, models.ManagedDomainsResponse{Domains: domains})
}

func (h DomainsHandler) Check(w http.ResponseWriter, r *http.Request) {
	domain, ok := decodeDomainRequest(w, r)
	if !ok {
		return
	}

	check, err := h.lookupDomain(domain)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, models.ErrorResponse{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, models.DomainCheckResponse{Check: check})
}

func (h DomainsHandler) Create(w http.ResponseWriter, r *http.Request) {
	domain, ok := decodeDomainRequest(w, r)
	if !ok {
		return
	}

	if err := h.ensureCaddyProvisioningAvailable(); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, models.ErrorResponse{Error: err.Error()})
		return
	}

	check, err := h.lookupDomain(domain)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, models.ErrorResponse{Error: err.Error()})
		return
	}
	if !check.DNSConfigured {
		writeJSON(w, http.StatusConflict, models.ErrorResponse{
			Error: "domain does not point to this server yet; add the correct DNS A/AAAA record and run the check again",
		})
		return
	}

	managed, err := h.storage.UpsertManagedDomain(domain)
	if err != nil {
		status := http.StatusInternalServerError
		message := "failed to save managed domain"
		if err == storage.ErrInvalid {
			status = http.StatusBadRequest
			message = "invalid domain"
		}
		writeJSON(w, status, models.ErrorResponse{Error: message})
		return
	}

	if err := h.syncCaddyConfig(); err != nil {
		writeJSON(w, http.StatusBadGateway, models.ErrorResponse{Error: err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, models.ManagedDomainResponse{
		Domain: managed,
		Check:  check,
	})
}

func decodeDomainRequest(w http.ResponseWriter, r *http.Request) (string, bool) {
	var req manageDomainRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return "", false
	}

	domain, err := normalizeDomain(req.Domain)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: err.Error()})
		return "", false
	}
	return domain, true
}

func normalizeDomain(raw string) (string, error) {
	normalized := strings.TrimSpace(strings.ToLower(raw))
	normalized = strings.TrimSuffix(normalized, ".")
	if normalized == "" {
		return "", fmt.Errorf("domain is required")
	}
	if strings.Contains(normalized, "://") || strings.Contains(normalized, "/") {
		return "", fmt.Errorf("enter a bare domain like app.example.com")
	}
	if strings.HasPrefix(normalized, "*.") {
		return "", fmt.Errorf("wildcard domains are not supported")
	}
	if !domainPattern.MatchString(normalized) {
		return "", fmt.Errorf("invalid domain")
	}
	return normalized, nil
}

func (h DomainsHandler) lookupDomain(domain string) (models.DomainCheckResult, error) {
	if len(h.cfg.PublicIPs) == 0 {
		return models.DomainCheckResult{}, fmt.Errorf("server public IP is not configured")
	}

	records, err := net.LookupIP(domain)
	if err != nil {
		return models.DomainCheckResult{}, fmt.Errorf("failed to resolve DNS for %s", domain)
	}

	expected := append([]string(nil), h.cfg.PublicIPs...)
	sort.Strings(expected)
	expected = slices.Compact(expected)

	resolved := make([]models.DomainDNSRecord, 0, len(records))
	matching := make([]models.DomainDNSRecord, 0)
	seen := make(map[string]struct{})
	for _, record := range records {
		recordType := "AAAA"
		ip := record.String()
		if ipv4 := record.To4(); ipv4 != nil {
			recordType = "A"
			ip = ipv4.String()
		}
		key := recordType + "|" + ip
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}

		entry := models.DomainDNSRecord{Type: recordType, Value: ip}
		resolved = append(resolved, entry)
		if slices.Contains(expected, ip) {
			matching = append(matching, entry)
		}
	}

	sort.Slice(resolved, func(i, j int) bool {
		if resolved[i].Type == resolved[j].Type {
			return resolved[i].Value < resolved[j].Value
		}
		return resolved[i].Type < resolved[j].Type
	})
	sort.Slice(matching, func(i, j int) bool {
		if matching[i].Type == matching[j].Type {
			return matching[i].Value < matching[j].Value
		}
		return matching[i].Type < matching[j].Type
	})

	return models.DomainCheckResult{
		Domain:          domain,
		ExpectedIPs:     expected,
		ResolvedRecords: resolved,
		MatchingRecords: matching,
		DNSConfigured:   len(matching) > 0,
	}, nil
}

func (h DomainsHandler) syncCaddyConfig() error {
	if err := h.ensureCaddyProvisioningAvailable(); err != nil {
		return err
	}

	domains, err := h.storage.ListManagedDomains()
	if err != nil {
		return fmt.Errorf("failed to load managed domains: %w", err)
	}

	if err := os.MkdirAll(h.cfg.CaddySitesPath, 0o755); err != nil {
		return fmt.Errorf("failed to prepare caddy sites directory: %w", err)
	}

	dynamicConfigPath := filepath.Join(h.cfg.CaddySitesPath, "rowful-domains.caddy")
	if err := os.WriteFile(dynamicConfigPath, []byte(renderManagedDomainsCaddyfile(domains)), 0o644); err != nil {
		return fmt.Errorf("failed to write caddy domain config: %w", err)
	}

	baseConfig, err := os.ReadFile(h.cfg.CaddyConfigPath)
	if err != nil {
		return fmt.Errorf("failed to read caddy config: %w", err)
	}

	adaptReq, err := http.NewRequest(http.MethodPost, strings.TrimRight(h.cfg.CaddyAdminURL, "/")+"/adapt", bytes.NewReader(baseConfig))
	if err != nil {
		return fmt.Errorf("failed to build caddy adapt request: %w", err)
	}
	adaptReq.Header.Set("Content-Type", "text/caddyfile")

	adaptRes, err := h.client.Do(adaptReq)
	if err != nil {
		return fmt.Errorf("failed to reach caddy admin API: %w", err)
	}
	defer func() { _ = adaptRes.Body.Close() }()

	adaptBody, err := io.ReadAll(adaptRes.Body)
	if err != nil {
		return fmt.Errorf("failed to read caddy adapt response: %w", err)
	}
	if adaptRes.StatusCode < 200 || adaptRes.StatusCode >= 300 {
		return fmt.Errorf("caddy adapt failed: %s", strings.TrimSpace(string(adaptBody)))
	}

	var adapted caddyAdaptResponse
	if err := json.Unmarshal(adaptBody, &adapted); err != nil {
		return fmt.Errorf("failed to parse caddy adapt response: %w", err)
	}
	if len(adapted.Result) == 0 {
		return fmt.Errorf("caddy adapt returned an empty config")
	}

	loadReq, err := http.NewRequest(http.MethodPost, strings.TrimRight(h.cfg.CaddyAdminURL, "/")+"/load", bytes.NewReader(adapted.Result))
	if err != nil {
		return fmt.Errorf("failed to build caddy load request: %w", err)
	}
	loadReq.Header.Set("Content-Type", "application/json")

	loadRes, err := h.client.Do(loadReq)
	if err != nil {
		return fmt.Errorf("failed to reload caddy: %w", err)
	}
	defer func() { _ = loadRes.Body.Close() }()

	loadBody, err := io.ReadAll(loadRes.Body)
	if err != nil {
		return fmt.Errorf("failed to read caddy load response: %w", err)
	}
	if loadRes.StatusCode < 200 || loadRes.StatusCode >= 300 {
		return fmt.Errorf("caddy reload failed: %s", strings.TrimSpace(string(loadBody)))
	}

	return nil
}

func (h DomainsHandler) ensureCaddyProvisioningAvailable() error {
	if strings.TrimSpace(h.cfg.CaddyAdminURL) == "" {
		return errCaddyUnavailable
	}
	if strings.TrimSpace(h.cfg.CaddyConfigPath) == "" {
		return fmt.Errorf("%w: CADDY_CONFIG_PATH is not set", errCaddyUnavailable)
	}
	if strings.TrimSpace(h.cfg.CaddySitesPath) == "" {
		return fmt.Errorf("%w: CADDY_SITES_PATH is not set", errCaddyUnavailable)
	}
	return nil
}

func renderManagedDomainsCaddyfile(domains []models.ManagedDomain) string {
	var builder strings.Builder
	builder.WriteString("# Managed by Rowful.\n")
	for _, domain := range domains {
		builder.WriteString(domain.Domain)
		builder.WriteString(" {\n")
		builder.WriteString("\timport common_site\n")
		builder.WriteString("}\n\n")
	}
	return builder.String()
}
