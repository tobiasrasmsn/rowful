package handlers

import (
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"log"
	"net"
	"net/http"
	"net/mail"
	"net/smtp"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"

	"rowful/models"
	"rowful/storage"
)

type sendEmailRequest struct {
	To         string   `json:"to"`
	Recipients []string `json:"recipients"`
	Targets    []struct {
		Email string            `json:"email"`
		Vars  map[string]string `json:"vars"`
	} `json:"targets"`
	Subject string `json:"subject"`
	Message string `json:"message"`
}

const (
	maxEmailRecipients       = 25
	emailRecipientThrottleMs = 1200
	emailQueueCapacity       = 512
	emailWorkerCount         = 2
)

type queuedEmailJob struct {
	id         string
	recipients []queuedEmailRecipient
	subject    string
	message    string
	smtp       models.SMTPSettings
}

type queuedEmailRecipient struct {
	email string
	vars  map[string]string
}

var (
	emailQueue     chan queuedEmailJob
	emailQueueOnce sync.Once
	emailJobSeq    atomic.Uint64
)

func (h FilesHandler) SendEmail(w http.ResponseWriter, r *http.Request) {
	h.sendWorkbookEmail(w, r, false)
}

func (h FilesHandler) SendTestEmail(w http.ResponseWriter, r *http.Request) {
	h.sendWorkbookEmail(w, r, true)
}

func (h FilesHandler) sendWorkbookEmail(w http.ResponseWriter, r *http.Request, testMode bool) {
	workbookID := chi.URLParam(r, "id")
	if strings.TrimSpace(workbookID) == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "missing file id"})
		return
	}
	if _, err := requireWorkbookAccess(r, h.storage, workbookID); err != nil {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "file not found"})
		return
	}

	var req sendEmailRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "invalid JSON body"})
		return
	}

	recipients, err := normalizeTargets(req.Targets, req.To, req.Recipients)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: err.Error()})
		return
	}
	if testMode && len(recipients) != 1 {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "test email supports exactly one recipient"})
		return
	}

	settings, err := h.storage.GetFileSettings(workbookID)
	if err != nil {
		if err == storage.ErrNotFound {
			writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "file not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, models.ErrorResponse{Error: "failed to load file settings"})
		return
	}

	subject := strings.TrimSpace(req.Subject)
	message := req.Message
	if testMode {
		if subject == "" {
			subject = "Rowful SMTP test"
		}
		if strings.TrimSpace(message) == "" {
			message = "This is a test email from Rowful."
		}
	}

	if subject == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "subject is required"})
		return
	}
	if strings.TrimSpace(message) == "" {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "message is required"})
		return
	}

	jobID, err := enqueueEmailJob(queuedEmailJob{
		recipients: recipients,
		subject:    subject,
		message:    message,
		smtp:       settings.Email,
	})
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, models.ErrorResponse{Error: err.Error()})
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]any{
		"status":   "queued",
		"jobId":    jobID,
		"queuedTo": len(recipients),
		"throttle": emailRecipientThrottleMs,
	})
}

func initEmailDispatcher() {
	emailQueueOnce.Do(func() {
		emailQueue = make(chan queuedEmailJob, emailQueueCapacity)
		for workerIdx := 0; workerIdx < emailWorkerCount; workerIdx += 1 {
			go runEmailWorker(workerIdx + 1)
		}
	})
}

func enqueueEmailJob(job queuedEmailJob) (string, error) {
	initEmailDispatcher()
	job.id = strconv.FormatUint(emailJobSeq.Add(1), 10)
	select {
	case emailQueue <- job:
		return job.id, nil
	default:
		return "", errors.New("email queue is full, please retry")
	}
}

func runEmailWorker(workerID int) {
	for job := range emailQueue {
		if err := sendSMTPEmailsWithThrottle(job.smtp, job.recipients, job.subject, job.message); err != nil {
			log.Printf("email job %s failed on worker %d: %v", job.id, workerID, err)
			continue
		}
		log.Printf("email job %s sent to %d recipient(s)", job.id, len(job.recipients))
	}
}

func normalizeRecipients(single string, many []string) ([]string, error) {
	candidates := make([]string, 0, len(many)+1)
	if strings.TrimSpace(single) != "" {
		candidates = append(candidates, single)
	}
	candidates = append(candidates, many...)

	seen := map[string]struct{}{}
	recipients := make([]string, 0, len(candidates))

	for _, candidate := range candidates {
		parsedList, err := mail.ParseAddressList(candidate)
		if err != nil {
			return nil, errors.New("invalid recipient email")
		}
		for _, addr := range parsedList {
			email := strings.TrimSpace(addr.Address)
			if email == "" {
				continue
			}
			key := strings.ToLower(email)
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			recipients = append(recipients, email)
		}
	}

	if len(recipients) == 0 {
		return nil, errors.New("at least one recipient email is required")
	}
	if len(recipients) > maxEmailRecipients {
		return nil, fmt.Errorf("maximum %d recipients per send", maxEmailRecipients)
	}
	return recipients, nil
}

func normalizeTargets(
	targets []struct {
		Email string            `json:"email"`
		Vars  map[string]string `json:"vars"`
	},
	single string,
	many []string,
) ([]queuedEmailRecipient, error) {
	if len(targets) > 0 {
		seen := map[string]struct{}{}
		normalized := make([]queuedEmailRecipient, 0, len(targets))
		for _, target := range targets {
			email := strings.TrimSpace(target.Email)
			if _, err := mail.ParseAddress(email); err != nil {
				return nil, errors.New("invalid recipient email")
			}
			key := strings.ToLower(email)
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			normalized = append(normalized, queuedEmailRecipient{
				email: email,
				vars:  normalizeSnippetVars(target.Vars),
			})
		}
		if len(normalized) == 0 {
			// Fallback to plain recipients if target payload was present but unusable.
			return normalizeTargets(nil, single, many)
		}
		if len(normalized) > maxEmailRecipients {
			return nil, fmt.Errorf("maximum %d recipients per send", maxEmailRecipients)
		}
		return normalized, nil
	}

	recipients, err := normalizeRecipients(single, many)
	if err != nil {
		return nil, err
	}
	normalized := make([]queuedEmailRecipient, 0, len(recipients))
	for _, email := range recipients {
		normalized = append(normalized, queuedEmailRecipient{email: email, vars: map[string]string{}})
	}
	return normalized, nil
}

func normalizeSnippetVars(vars map[string]string) map[string]string {
	out := make(map[string]string, len(vars))
	for key, value := range vars {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" {
			continue
		}
		out[strings.ToLower(trimmedKey)] = value
	}
	return out
}

func applySnippets(template string, vars map[string]string) string {
	if len(vars) == 0 {
		return template
	}
	return snippetPattern.ReplaceAllStringFunc(template, func(match string) string {
		found := snippetPattern.FindStringSubmatch(match)
		if len(found) < 2 {
			return match
		}
		key := strings.ToLower(strings.TrimSpace(found[1]))
		if replacement, ok := vars[key]; ok {
			return replacement
		}
		return match
	})
}

func sendSMTPEmailsWithThrottle(cfg models.SMTPSettings, recipients []queuedEmailRecipient, subject, message string) error {
	delay := time.Duration(emailRecipientThrottleMs) * time.Millisecond
	for idx, recipient := range recipients {
		resolvedSubject := applySnippets(subject, recipient.vars)
		resolvedMessage := applySnippets(message, recipient.vars)
		if err := sendSMTPEmail(cfg, recipient.email, resolvedSubject, resolvedMessage); err != nil {
			return fmt.Errorf("failed to send to %s: %w", recipient.email, err)
		}
		if idx < len(recipients)-1 {
			time.Sleep(delay)
		}
	}
	return nil
}

func sendSMTPEmail(cfg models.SMTPSettings, to, subject, message string) error {
	host := strings.TrimSpace(cfg.Host)
	if host == "" {
		return errors.New("smtp host is required")
	}
	port := cfg.Port
	if port < 1 || port > 65535 {
		return errors.New("smtp port must be between 1 and 65535")
	}
	from := strings.TrimSpace(cfg.FromEmail)
	if from == "" {
		return errors.New("smtp from email is required")
	}
	if _, err := mail.ParseAddress(from); err != nil {
		return errors.New("invalid smtp from email")
	}
	if _, err := mail.ParseAddress(to); err != nil {
		return errors.New("invalid recipient email")
	}

	addr := net.JoinHostPort(host, fmt.Sprintf("%d", port))
	msg := buildEmailMessage(cfg.FromName, from, to, subject, message)

	if cfg.UseTLS {
		if err := sendWithImplicitTLS(addr, host, cfg, from, to, msg); err == nil {
			return nil
		}
	}
	return sendWithSMTP(addr, host, cfg, from, to, msg)
}

func sendWithImplicitTLS(addr, host string, cfg models.SMTPSettings, from, to string, msg []byte) error {
	conn, err := tls.DialWithDialer(&net.Dialer{Timeout: 10 * time.Second}, "tcp", addr, &tls.Config{
		ServerName: host,
		MinVersion: tls.VersionTLS12,
	})
	if err != nil {
		return fmt.Errorf("connect smtp tls: %w", err)
	}
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("create smtp client: %w", err)
	}
	defer func() { _ = client.Close() }()
	return sendWithClient(client, host, cfg, from, to, msg, false)
}

func sendWithSMTP(addr, host string, cfg models.SMTPSettings, from, to string, msg []byte) error {
	client, err := smtp.Dial(addr)
	if err != nil {
		return fmt.Errorf("connect smtp: %w", err)
	}
	defer func() { _ = client.Close() }()
	return sendWithClient(client, host, cfg, from, to, msg, cfg.UseTLS)
}

func sendWithClient(client *smtp.Client, host string, cfg models.SMTPSettings, from, to string, msg []byte, requireStartTLS bool) error {
	if requireStartTLS {
		ok, _ := client.Extension("STARTTLS")
		if !ok {
			return errors.New("smtp server does not support STARTTLS")
		}
		if err := client.StartTLS(&tls.Config{
			ServerName: host,
			MinVersion: tls.VersionTLS12,
		}); err != nil {
			return fmt.Errorf("starttls failed: %w", err)
		}
	}

	username := strings.TrimSpace(cfg.Username)
	password := cfg.Password
	if username != "" || password != "" {
		if username == "" || password == "" {
			return errors.New("smtp username and password must both be set")
		}
		auth := smtp.PlainAuth("", username, password, host)
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("smtp auth failed: %w", err)
		}
	}

	if err := client.Mail(from); err != nil {
		return fmt.Errorf("smtp mail from failed: %w", err)
	}
	if err := client.Rcpt(to); err != nil {
		return fmt.Errorf("smtp rcpt failed: %w", err)
	}
	writer, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp data failed: %w", err)
	}
	if _, err := writer.Write(msg); err != nil {
		_ = writer.Close()
		return fmt.Errorf("smtp write failed: %w", err)
	}
	if err := writer.Close(); err != nil {
		return fmt.Errorf("smtp finalize failed: %w", err)
	}
	if err := client.Quit(); err != nil && !errors.Is(err, io.EOF) {
		return fmt.Errorf("smtp quit failed: %w", err)
	}
	return nil
}

func buildEmailMessage(fromName, fromEmail, to, subject, body string) []byte {
	cleanSubject := stripHeaderBreaks(subject)
	cleanTo := stripHeaderBreaks(to)
	from := strings.TrimSpace(fromEmail)
	if name := strings.TrimSpace(fromName); name != "" {
		from = fmt.Sprintf("%s <%s>", stripHeaderBreaks(name), stripHeaderBreaks(fromEmail))
	}

	normalizedBody := strings.ReplaceAll(body, "\r\n", "\n")
	normalizedBody = strings.ReplaceAll(normalizedBody, "\r", "\n")
	normalizedBody = strings.ReplaceAll(normalizedBody, "\n", "\r\n")
	htmlBody := strings.ReplaceAll(html.EscapeString(strings.ReplaceAll(normalizedBody, "\r\n", "\n")), "\n", "<br>\n")
	boundary := "rowful-mixed-" + strconv.FormatInt(time.Now().UnixNano(), 10)

	headers := []string{
		"From: " + from,
		"To: " + cleanTo,
		"Subject: " + cleanSubject,
		"MIME-Version: 1.0",
		`Content-Type: multipart/alternative; boundary="` + boundary + `"`,
		"",
	}

	parts := []string{
		"--" + boundary,
		`Content-Type: text/plain; charset="UTF-8"`,
		"Content-Transfer-Encoding: 8bit",
		"",
		normalizedBody,
		"--" + boundary,
		`Content-Type: text/html; charset="UTF-8"`,
		"Content-Transfer-Encoding: 8bit",
		"",
		"<html><body>" + htmlBody + "</body></html>",
		"--" + boundary + "--",
	}

	return []byte(strings.Join(headers, "\r\n") + "\r\n" + strings.Join(parts, "\r\n"))
}

func stripHeaderBreaks(value string) string {
	return strings.NewReplacer("\r", "", "\n", "").Replace(strings.TrimSpace(value))
}

var snippetPattern = regexp.MustCompile(`\{([A-Za-z0-9_]+)\}`)
