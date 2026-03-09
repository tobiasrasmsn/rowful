package models

import "time"

type CellStyle struct {
	FontFamily string `json:"fontFamily,omitempty"`
	FontSize   int    `json:"fontSize,omitempty"`
	Bold       bool   `json:"bold,omitempty"`
	Italic     bool   `json:"italic,omitempty"`
	Underline  bool   `json:"underline,omitempty"`
	Strike     bool   `json:"strike,omitempty"`
	FontColor  string `json:"fontColor,omitempty"`
	FillColor  string `json:"fillColor,omitempty"`
	HAlign     string `json:"hAlign,omitempty"`
	VAlign     string `json:"vAlign,omitempty"`
	Border     string `json:"border,omitempty"`
	Overflow   string `json:"overflow,omitempty"`
	WrapText   bool   `json:"wrapText,omitempty"`
	NumFmt     string `json:"numFmt,omitempty"`
}

type CellStylePatch struct {
	FontFamily *string `json:"fontFamily,omitempty"`
	FontSize   *int    `json:"fontSize,omitempty"`
	Bold       *bool   `json:"bold,omitempty"`
	Italic     *bool   `json:"italic,omitempty"`
	Underline  *bool   `json:"underline,omitempty"`
	Strike     *bool   `json:"strike,omitempty"`
	FontColor  *string `json:"fontColor,omitempty"`
	FillColor  *string `json:"fillColor,omitempty"`
	HAlign     *string `json:"hAlign,omitempty"`
	VAlign     *string `json:"vAlign,omitempty"`
	Border     *string `json:"border,omitempty"`
	Overflow   *string `json:"overflow,omitempty"`
	WrapText   *bool   `json:"wrapText,omitempty"`
	NumFmt     *string `json:"numFmt,omitempty"`
}

type Cell struct {
	Address string     `json:"address"`
	Row     int        `json:"row"`
	Col     int        `json:"col"`
	Type    string     `json:"type"`
	Value   string     `json:"value"`
	Display string     `json:"display,omitempty"`
	Formula string     `json:"formula,omitempty"`
	Style   *CellStyle `json:"style,omitempty"`
}

type Row struct {
	Index int    `json:"index"`
	Cells []Cell `json:"cells"`
}

type Sheet struct {
	Name   string `json:"name"`
	Index  int    `json:"index"`
	MaxRow int    `json:"maxRow"`
	MaxCol int    `json:"maxCol"`
	Rows   []Row  `json:"rows"`
}

type SheetMeta struct {
	Name   string `json:"name"`
	Index  int    `json:"index"`
	MaxRow int    `json:"maxRow"`
	MaxCol int    `json:"maxCol"`
}

type CellRange struct {
	RowStart int `json:"rowStart"`
	RowEnd   int `json:"rowEnd"`
	ColStart int `json:"colStart"`
	ColEnd   int `json:"colEnd"`
}

type Workbook struct {
	ID          string      `json:"id"`
	FileName    string      `json:"fileName"`
	FileHash    string      `json:"fileHash"`
	Sheets      []SheetMeta `json:"sheets"`
	ActiveSheet string      `json:"activeSheet"`
	CreatedAt   time.Time   `json:"createdAt"`
}

type SMTPSettings struct {
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	FromEmail string `json:"fromEmail"`
	FromName  string `json:"fromName"`
	UseTLS    bool   `json:"useTLS"`
}

type FileSettings struct {
	Currency string       `json:"currency"`
	Email    SMTPSettings `json:"email"`
}

type FileSettingsResponse struct {
	Settings FileSettings `json:"settings"`
}

type UploadResponse struct {
	Workbook Workbook `json:"workbook"`
	Sheet    Sheet    `json:"sheet"`
}

type SheetResponse struct {
	Workbook Workbook `json:"workbook"`
	Sheet    Sheet    `json:"sheet"`
}

type FileEntry struct {
	ID           string    `json:"id"`
	FileName     string    `json:"fileName"`
	FilePath     string    `json:"filePath"`
	FileHash     string    `json:"fileHash"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
	LastOpenedAt time.Time `json:"lastOpenedAt"`
}

type FilesResponse struct {
	Files []FileEntry `json:"files"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

type ManagedDomain struct {
	Domain    string    `json:"domain"`
	CreatedAt time.Time `json:"createdAt"`
}

type DomainDNSRecord struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

type DomainCheckResult struct {
	Domain          string            `json:"domain"`
	ExpectedIPs     []string          `json:"expectedIps"`
	ResolvedRecords []DomainDNSRecord `json:"resolvedRecords"`
	MatchingRecords []DomainDNSRecord `json:"matchingRecords"`
	DNSConfigured   bool              `json:"dnsConfigured"`
}

type ManagedDomainsResponse struct {
	Domains []ManagedDomain `json:"domains"`
}

type DomainCheckResponse struct {
	Check DomainCheckResult `json:"check"`
}

type ManagedDomainResponse struct {
	Domain ManagedDomain     `json:"domain"`
	Check  DomainCheckResult `json:"check"`
}
