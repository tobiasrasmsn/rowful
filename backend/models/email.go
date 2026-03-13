package models

import "time"

type EmailProfile struct {
	ID        string       `json:"id"`
	Nickname  string       `json:"nickname"`
	SMTP      SMTPSettings `json:"smtp"`
	CreatedAt time.Time    `json:"createdAt"`
	UpdatedAt time.Time    `json:"updatedAt"`
}

type EmailProfileInput struct {
	Nickname string       `json:"nickname"`
	SMTP     SMTPSettings `json:"smtp"`
}

type EmailProfilesResponse struct {
	Profiles []EmailProfile `json:"profiles"`
}

type EmailProfileResponse struct {
	Profile EmailProfile `json:"profile"`
}
