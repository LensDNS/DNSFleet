package adguard

// RewriteEntry mirrors OpenAPI RewriteEntry (api/ADGUARD_HOME_CONTROL_API.md §4).
type RewriteEntry struct {
	Domain  string `json:"domain"`
	Answer  string `json:"answer"`
	Enabled *bool  `json:"enabled,omitempty"`
}

// RewriteUpdate is the body for PUT /control/rewrite/update.
type RewriteUpdate struct {
	Target *RewriteEntry `json:"target"`
	Update *RewriteEntry `json:"update"`
}
