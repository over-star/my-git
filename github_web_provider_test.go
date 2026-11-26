package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

func TestIsSemverNewer(t *testing.T) {
	cases := []struct {
		cand string
		cur  string
		want bool
	}{
		{"v0.1.3", "0.1.2", true},
		{"0.2.0", "0.1.9", true},
		{"v1.0.0", "0.9.9", true},
		{"v0.1.2", "0.1.2", false},
		{"0.1.1", "0.1.2", false},
		{"v0.1.2", "0.1.2-beta.1", true},
		{"v0.1.2-beta.1", "0.1.2", false},
	}
	for _, tc := range cases {
		if got := isSemverNewer(tc.cand, tc.cur); got != tc.want {
			t.Errorf("isSemverNewer(%q, %q) = %v, want %v", tc.cand, tc.cur, got, tc.want)
		}
	}
}

func TestGitHubWebProviderCheckAndDownload(t *testing.T) {
	payload := []byte("fake-zip-payload-bytes")
	sum := sha256.Sum256(payload)
	sumHex := hex.EncodeToString(sum[:])

	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/over-star/my-git/releases/latest":
			http.Redirect(w, r, "/over-star/my-git/releases/tag/v0.2.0", http.StatusFound)
		case "/over-star/my-git/releases/tag/v0.2.0":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("<html>Release v0.2.0</html>"))
		case "/over-star/my-git/releases/download/v0.2.0/gitpulse-windows-amd64.zip":
			if r.Method == http.MethodHead {
				w.Header().Set("Content-Length", fmt.Sprintf("%d", len(payload)))
				w.WriteHeader(http.StatusOK)
				return
			}
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(payload)))
			_, _ = w.Write(payload)
		case "/over-star/my-git/releases/download/v0.2.0/checksums.txt":
			_, _ = fmt.Fprintf(w, "%s  gitpulse-windows-amd64.zip\n", sumHex)
		case "/over-star/my-git/releases.atom":
			_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>tag:github.com,2008:Repository/1/v0.2.0</id>
    <updated>2026-11-26T08:00:00Z</updated>
    <title>Release v0.2.0</title>
    <content type="html">&lt;p&gt;Bug fixes and tray support&lt;/p&gt;</content>
  </entry>
</feed>`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	// Simulate an api.github.com server that always returns 403 rate limit exceeded
	api403Srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"message":"API rate limit exceeded"}`))
	}))
	defer api403Srv.Close()

	p := &smartGitHubProvider{
		repo:     "over-star/my-git",
		apiBase:  api403Srv.URL,
		getToken: func() string { return "" },
		web:      newGitHubWebProvider(srv.URL + "/over-star/my-git"),
	}

	req := updater.CheckRequest{
		CurrentVersion: "0.1.2",
		Platform:       "windows",
		Arch:           "amd64",
	}
	rel, err := p.Check(context.Background(), req)
	if err != nil {
		t.Fatalf("Check failed: %v", err)
	}
	if rel == nil {
		t.Fatal("expected newer release v0.2.0, got nil")
	}
	if rel.Version != "0.2.0" || rel.Artifact.Filename != "gitpulse-windows-amd64.zip" || rel.Artifact.Size != int64(len(payload)) {
		t.Fatalf("unexpected release: %+v", rel)
	}
	if rel.Verification == nil || rel.Verification.DigestAlgo != "sha256" || hex.EncodeToString(rel.Verification.Digest) != sumHex {
		t.Fatalf("unexpected verification: %+v", rel.Verification)
	}
	if rel.Notes != "Bug fixes and tray support" {
		t.Fatalf("unexpected notes: %q", rel.Notes)
	}

	var buf bytes.Buffer
	var lastWritten int64
	if err := p.Download(context.Background(), rel, &buf, func(written, total int64) {
		lastWritten = written
	}); err != nil {
		t.Fatalf("Download failed: %v", err)
	}
	if !bytes.Equal(buf.Bytes(), payload) || lastWritten != int64(len(payload)) {
		t.Fatalf("downloaded payload mismatch: got %q (written=%d)", buf.String(), lastWritten)
	}
}
