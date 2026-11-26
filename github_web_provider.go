package main

import (
	"context"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/updater"
	ghprovider "github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

var errPrivateRepoAuthRequired = errors.New("当前仓库为私有仓库或需要登录，请在「设置 → 软件更新」中配置 GitHub Token 后重试")

// smartGitHubProvider routes update checks between the unthrottled GitHub web
// endpoints (when no token is configured) and the authenticated GitHub REST API
// (when a token is configured), avoiding the 60 req/hr anonymous IP rate limit.
type smartGitHubProvider struct {
	repo     string
	apiBase  string
	getToken func() string
	web      *githubWebProvider
}

func newSmartGitHubProvider(repo string, getToken func() string) *smartGitHubProvider {
	return &smartGitHubProvider{
		repo:     repo,
		getToken: getToken,
		web:      newGitHubWebProvider("https://github.com/" + repo),
	}
}

func (p *smartGitHubProvider) Name() string { return "github" }

func (p *smartGitHubProvider) Check(ctx context.Context, req updater.CheckRequest) (*updater.Release, error) {
	token := ""
	if p.getToken != nil {
		token = strings.TrimSpace(p.getToken())
	}

	if token != "" {
		apiProv, err := ghprovider.New(ghprovider.Config{
			Repository:    p.repo,
			Token:         token,
			BaseURL:       p.apiBase,
			ChecksumAsset: "checksums.txt",
		})
		if err == nil {
			rel, apiErr := apiProv.Check(ctx, req)
			if apiErr == nil {
				return rel, nil
			}
			// Fall back to web check only if it isn't an explicit auth failure
			if webRel, webErr := p.web.Check(ctx, req); webErr == nil {
				return webRel, nil
			}
			return nil, apiErr
		}
	}

	// Unauthenticated: prefer web redirect + direct release download (no 60 req/hr API rate limit)
	rel, webErr := p.web.Check(ctx, req)
	if webErr == nil {
		return rel, nil
	}
	if errors.Is(webErr, errPrivateRepoAuthRequired) {
		return nil, webErr
	}

	apiProv, err := ghprovider.New(ghprovider.Config{
		Repository:    p.repo,
		BaseURL:       p.apiBase,
		ChecksumAsset: "checksums.txt",
	})
	if err != nil {
		return nil, webErr
	}
	apiRel, apiErr := apiProv.Check(ctx, req)
	if apiErr == nil {
		return apiRel, nil
	}
	return nil, fmt.Errorf("%v; api fallback: %w", webErr, apiErr)
}

func (p *smartGitHubProvider) Download(ctx context.Context, rel *updater.Release, dst io.Writer, onProgress func(written, total int64)) error {
	if p.getToken != nil {
		if token := strings.TrimSpace(p.getToken()); token != "" {
			if apiProv, err := ghprovider.New(ghprovider.Config{
				Repository: p.repo,
				Token:      token,
				BaseURL:    p.apiBase,
			}); err == nil {
				return apiProv.Download(ctx, rel, dst, onProgress)
			}
		}
	}
	return p.web.Download(ctx, rel, dst, onProgress)
}

// githubWebProvider checks GitHub Releases via github.com web endpoints
// (/releases/latest redirect, /releases.atom, and /releases/download/<tag>/...)
// which are not subject to the api.github.com 60 req/hr anonymous IP limit.
type githubWebProvider struct {
	webBase string
	client  *http.Client
}

func newGitHubWebProvider(repoWebURL string) *githubWebProvider {
	return &githubWebProvider{
		webBase: strings.TrimRight(repoWebURL, "/"),
		client:  &http.Client{Timeout: 30 * time.Second},
	}
}

func (p *githubWebProvider) Name() string { return "github-web" }

func (p *githubWebProvider) Check(ctx context.Context, req updater.CheckRequest) (*updater.Release, error) {
	latestURL := p.webBase + "/releases/latest"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, latestURL, nil)
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("User-Agent", "mygit-updater/1.0")

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("检查更新网络请求失败: %w", err)
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	_ = resp.Body.Close()

	finalURL := ""
	if resp.Request != nil && resp.Request.URL != nil {
		finalURL = resp.Request.URL.String()
	}
	if strings.Contains(finalURL, "/login") || resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return nil, errPrivateRepoAuthRequired
	}
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		return nil, fmt.Errorf("GitHub 返回异常状态码 HTTP %d", resp.StatusCode)
	}

	if !strings.Contains(finalURL, "/releases/tag/") {
		// /releases/latest redirects to /releases when no release is published yet
		return nil, nil
	}

	tag := path.Base(resp.Request.URL.Path)
	if tag == "" || tag == "." || tag == "/" {
		return nil, nil
	}
	if !isSemverNewer(tag, req.CurrentVersion) {
		return nil, nil
	}

	plat := req.Platform
	if plat == "" {
		plat = "windows"
	}
	arch := req.Arch
	if arch == "" {
		arch = "amd64"
	}
	assetName := fmt.Sprintf("gitpulse-%s-%s.zip", plat, arch)
	assetURL := fmt.Sprintf("%s/releases/download/%s/%s", p.webBase, tag, assetName)

	assetSize, err := p.probeAssetSize(ctx, assetURL)
	if err != nil {
		return nil, fmt.Errorf("发现新版本 %s，但获取更新包 %s 失败: %w", tag, assetName, err)
	}

	ver := strings.TrimPrefix(tag, "v")
	out := &updater.Release{
		Version: ver,
		Channel: "stable",
		Name:    tag,
		Artifact: updater.Artifact{
			Filename: assetName,
			Filetype: "zip",
			Size:     assetSize,
			Platform: plat,
			Arch:     arch,
		},
		Metadata: map[string]any{
			"github.release.tag":     tag,
			"github.release.htmlURL": finalURL,
			"github.asset.url":       assetURL,
		},
	}

	if digest, err := p.fetchChecksum(ctx, tag, assetName); err == nil && len(digest) > 0 {
		out.Verification = &updater.Verification{
			DigestAlgo: "sha256",
			Digest:     digest,
		}
	}

	if title, notes, pubAt := p.fetchAtomMetadata(ctx, tag); title != "" || notes != "" || !pubAt.IsZero() {
		if title != "" {
			out.Name = title
		}
		if notes != "" {
			out.Notes = notes
		}
		if !pubAt.IsZero() {
			out.PublishedAt = pubAt
		}
	}

	return out, nil
}

func (p *githubWebProvider) probeAssetSize(ctx context.Context, assetURL string) (int64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, assetURL, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("User-Agent", "mygit-updater/1.0")
	resp, err := p.client.Do(req)
	if err != nil {
		return 0, err
	}
	_ = resp.Body.Close()
	if resp.StatusCode == http.StatusMethodNotAllowed {
		// Some mirrors/CDNs reject HEAD; fall back to range GET
		req2, err := http.NewRequestWithContext(ctx, http.MethodGet, assetURL, nil)
		if err != nil {
			return 0, err
		}
		req2.Header.Set("Range", "bytes=0-0")
		req2.Header.Set("User-Agent", "mygit-updater/1.0")
		resp2, err := p.client.Do(req2)
		if err != nil {
			return 0, err
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(resp2.Body, 1024))
		_ = resp2.Body.Close()
		if resp2.StatusCode >= 200 && resp2.StatusCode < 300 {
			return parseContentRangeTotal(resp2.Header.Get("Content-Range")), nil
		}
		return 0, fmt.Errorf("HTTP %d", resp2.StatusCode)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	if resp.ContentLength > 0 {
		return resp.ContentLength, nil
	}
	return 0, nil
}

func parseContentRangeTotal(cr string) int64 {
	idx := strings.LastIndex(cr, "/")
	if idx < 0 {
		return 0
	}
	total, err := strconv.ParseInt(strings.TrimSpace(cr[idx+1:]), 10, 64)
	if err != nil || total < 0 {
		return 0
	}
	return total
}

func (p *githubWebProvider) fetchChecksum(ctx context.Context, tag, targetName string) ([]byte, error) {
	urlStr := fmt.Sprintf("%s/releases/download/%s/checksums.txt", p.webBase, tag)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "mygit-updater/1.0")
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("checksum HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		name := strings.TrimPrefix(strings.TrimPrefix(fields[len(fields)-1], "*"), "./")
		if name != targetName {
			continue
		}
		digest, err := hex.DecodeString(fields[0])
		if err != nil {
			return nil, err
		}
		return digest, nil
	}
	return nil, nil
}

type atomFeed struct {
	Entries []atomEntry `xml:"entry"`
}

type atomEntry struct {
	ID      string `xml:"id"`
	Title   string `xml:"title"`
	Updated string `xml:"updated"`
	Content string `xml:"content"`
}

var htmlTagRe = regexp.MustCompile(`<[^>]+>`)

func (p *githubWebProvider) fetchAtomMetadata(ctx context.Context, tag string) (string, string, time.Time) {
	ctxShort, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctxShort, http.MethodGet, p.webBase+"/releases.atom", nil)
	if err != nil {
		return "", "", time.Time{}
	}
	req.Header.Set("User-Agent", "mygit-updater/1.0")
	resp, err := p.client.Do(req)
	if err != nil {
		return "", "", time.Time{}
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", "", time.Time{}
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		return "", "", time.Time{}
	}
	var feed atomFeed
	if err := xml.Unmarshal(raw, &feed); err != nil {
		return "", "", time.Time{}
	}
	for _, e := range feed.Entries {
		if strings.HasSuffix(e.ID, "/"+tag) || strings.TrimSpace(e.Title) == tag {
			var pub time.Time
			if t, perr := time.Parse(time.RFC3339, strings.TrimSpace(e.Updated)); perr == nil {
				pub = t
			}
			notes := html.UnescapeString(htmlTagRe.ReplaceAllString(
				strings.NewReplacer("</p>", "\n", "</li>", "\n", "<br>", "\n", "<br/>", "\n", "<br />", "\n").Replace(e.Content),
				"",
			))
			return strings.TrimSpace(e.Title), strings.TrimSpace(notes), pub
		}
	}
	return "", "", time.Time{}
}

func (p *githubWebProvider) Download(ctx context.Context, rel *updater.Release, dst io.Writer, onProgress func(written, total int64)) error {
	if rel == nil || rel.Metadata == nil {
		return errors.New("release missing metadata")
	}
	urlStr, ok := rel.Metadata["github.asset.url"].(string)
	if !ok || strings.TrimSpace(urlStr) == "" {
		return errors.New("release metadata missing asset URL")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/octet-stream")
	req.Header.Set("User-Agent", "mygit-updater/1.0")

	dlClient := &http.Client{Timeout: 10 * time.Minute}
	resp, err := dlClient.Do(req)
	if err != nil {
		return fmt.Errorf("下载更新包失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("下载更新包失败: HTTP %d", resp.StatusCode)
	}

	total := rel.Artifact.Size
	if total == 0 && resp.ContentLength > 0 {
		total = resp.ContentLength
	}
	var written int64
	buf := make([]byte, 64*1024)
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := dst.Write(buf[:n]); werr != nil {
				return werr
			}
			written += int64(n)
			if onProgress != nil {
				onProgress(written, total)
			}
		}
		if rerr == io.EOF {
			return nil
		}
		if rerr != nil {
			return rerr
		}
	}
}

// isSemverNewer compares vCandidate against vCurrent (handles optional leading "v" and "-prerelease").
func isSemverNewer(vCandidate, vCurrent string) bool {
	cNums, cPre := parseSemverParts(vCandidate)
	curNums, curPre := parseSemverParts(vCurrent)
	for i := 0; i < 3; i++ {
		if cNums[i] != curNums[i] {
			return cNums[i] > curNums[i]
		}
	}
	// Equal numeric parts: stable release (empty prerelease) > prerelease
	if cPre == "" && curPre != "" {
		return true
	}
	if cPre != "" && curPre == "" {
		return false
	}
	return cPre > curPre
}

func parseSemverParts(v string) ([3]int, string) {
	s := strings.TrimPrefix(strings.TrimSpace(v), "v")
	if idx := strings.IndexByte(s, '+'); idx >= 0 {
		s = s[:idx]
	}
	pre := ""
	if idx := strings.IndexByte(s, '-'); idx >= 0 {
		pre = s[idx+1:]
		s = s[:idx]
	}
	var nums [3]int
	parts := strings.Split(s, ".")
	for i := 0; i < len(parts) && i < 3; i++ {
		nums[i], _ = strconv.Atoi(parts[i])
	}
	return nums, pre
}
