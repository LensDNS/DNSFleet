// Package webui embeds the Next.js static export (output: 'export') for same-origin
// delivery by the control plane. See internal/webui/README.md and the repo Makefile.
package webui

import (
	"embed"
	"io/fs"
)

//go:embed dist
var embeddedDist embed.FS

// Static is the filesystem rooted at the exported site (contents of internal/webui/dist).
var Static fs.FS

func init() {
	sub, err := fs.Sub(embeddedDist, "dist")
	if err != nil {
		panic("webui: fs.Sub(dist): " + err.Error())
	}
	Static = sub
}
