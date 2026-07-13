package migrations

import "embed"

// FS contains versioned PostgreSQL migrations applied at startup.
//
//go:embed *.sql
var FS embed.FS
