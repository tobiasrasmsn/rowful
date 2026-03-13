package models

import "time"

type AuthUser struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	IsAdmin   bool      `json:"isAdmin"`
	CreatedAt time.Time `json:"createdAt"`
}

type AuthBootstrap struct {
	SetupRequired bool `json:"setupRequired"`
	InviteOnly    bool `json:"inviteOnly"`
}

type AuthSessionResponse struct {
	Authenticated         bool          `json:"authenticated"`
	User                  *AuthUser     `json:"user,omitempty"`
	CSRFToken             string        `json:"csrfToken,omitempty"`
	Bootstrap             AuthBootstrap `json:"bootstrap"`
	ManagedDomainsEnabled bool          `json:"managedDomainsEnabled"`
}

type AllowlistEntry struct {
	Email          string     `json:"email"`
	CreatedAt      time.Time  `json:"createdAt"`
	InvitedByEmail string     `json:"invitedByEmail,omitempty"`
	ClaimedAt      *time.Time `json:"claimedAt,omitempty"`
	ClaimedByEmail string     `json:"claimedByEmail,omitempty"`
}

type AllowlistResponse struct {
	Entries []AllowlistEntry `json:"entries"`
}

type AuthSession struct {
	ID         string
	UserID     string
	CSRFToken  string
	ExpiresAt  time.Time
	CreatedAt  time.Time
	LastSeenAt time.Time
}
