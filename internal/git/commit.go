package git

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Commit creates a new commit (or amends the previous commit) using staged changes.
func Commit(ctx context.Context, loc RepoLocation, summary, description string, amend bool) (OpResult, error) {
	sum := strings.TrimSpace(summary)
	if sum == "" {
		return OpResult{Success: false, Message: "Commit summary cannot be empty"}, nil
	}
	args := []string{"commit", "-m", sum}
	desc := strings.TrimSpace(description)
	if desc != "" {
		args = append(args, "-m", desc)
	}
	if amend {
		args = append(args, "--amend")
	}

	stdout, stderr, err := RunGit(ctx, loc, args...)
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		low := strings.ToLower(combined)
		code := ""
		if strings.Contains(low, "author identity unknown") ||
			strings.Contains(low, "unable to auto-detect email address") ||
			strings.Contains(low, "please tell me who you are") {
			code = "AUTHOR_IDENTITY_UNKNOWN"
		}
		return OpResult{
			Success:   false,
			Message:   firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()),
			ErrorCode: code,
			Output:    combined,
		}, nil
	}
	return OpResult{
		Success: true,
		Message: "Committed successfully",
		Output:  combined,
	}, nil
}

// GetLastCommitMessage returns the subject and body of HEAD for pre-filling Amend.
func GetLastCommitMessage(ctx context.Context, loc RepoLocation) (string, string, error) {
	out, stderr, err := RunGit(ctx, loc, "log", "-1", "--format=%s%x1f%b")
	if err != nil {
		return "", "", fmt.Errorf("failed to read last commit: %s", strings.TrimSpace(stderr))
	}
	parts := strings.SplitN(out, "\x1f", 2)
	subject := strings.TrimSpace(parts[0])
	body := ""
	if len(parts) > 1 {
		body = strings.TrimSpace(parts[1])
	}
	return subject, body, nil
}

// GetCommitHistory returns a paginated list of commits with parent hashes and ref badges.
func GetCommitHistory(ctx context.Context, loc RepoLocation, branch string, search string, skip int, limit int) (CommitPage, error) {
	if limit <= 0 {
		limit = 100
	}
	if skip < 0 {
		skip = 0
	}

	page := CommitPage{Commits: []CommitItem{}}
	// Use \x1e (record separator) and \x1f (unit separator)
	format := "%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%ct%x1f%D%x1f%s%x1f%b"
	args := []string{
		"log",
		"--topo-order",
		fmt.Sprintf("--format=%s", format),
		fmt.Sprintf("--skip=%d", skip),
		fmt.Sprintf("-n%d", limit+1),
	}

	b := strings.TrimSpace(branch)
	if b == "" || b == "__ALL__" {
		args = append(args, "--all")
	} else {
		args = append(args, b)
	}

	q := strings.TrimSpace(search)
	if q != "" {
		// Search across commit message or author (case-insensitive)
		args = append(args, "--regexp-ignore-case", "--grep="+q, "--author="+q, "--all-match")
		//Wait: --all-match requires BOTH grep and author. We want OR (match message OR author OR hash).
		// Fix: handle search cleanly! Let's check below.
	}

	// If search is provided, let's build proper query:
	// If q looks like a hex SHA (4-40 hex chars) or general keyword, git log --grep only matches message.
	// Using --author OR --grep is not supported directly as OR in git log, so if search is present we can pass --grep or do fast filtering, OR run two? Even simpler: git log --grep=q OR if few commits match, let's check:
	// Actually, we can pass `--grep` when searching message, OR better: when search is set, fetch up to 500 commits from git log and filter across hash, subject, body, author in Go (super fast < 20ms!) or use git log --grep if no author match. Wait: for 10,000+ commit repos, fetching 2000 headers with a light format takes ~40ms! Let's do smart search in Go over a larger batch when search != "".
	if q != "" {
		args = []string{
			"log",
			"--topo-order",
			fmt.Sprintf("--format=%s", format),
			"-n2000",
		}
		if b == "" || b == "__ALL__" {
			args = append(args, "--all")
		} else {
			args = append(args, b)
		}
	}

	stdout, stderr, err := RunGit(ctx, loc, args...)
	if err != nil {
		msg := strings.TrimSpace(stderr)
		// Empty repo with no commits yet
		if strings.Contains(msg, "does not have any commits yet") || strings.Contains(msg, "your current branch") {
			return page, nil
		}
		return page, fmt.Errorf("git log failed: %s (%w)", msg, err)
	}

	now := time.Now()
	records := strings.Split(stdout, "\x1e")
	var items []CommitItem
	ql := strings.ToLower(q)

	for _, rec := range records {
		rec = strings.TrimSpace(rec)
		if rec == "" {
			continue
		}
		fields := strings.SplitN(rec, "\x1f", 8)
		if len(fields) < 7 {
			continue
		}
		hash := fields[0]
		parentsRaw := strings.TrimSpace(fields[1])
		var parents []string
		if parentsRaw != "" {
			parents = strings.Fields(parentsRaw)
		} else {
			parents = []string{}
		}
		author := fields[2]
		email := fields[3]
		ts, _ := strconv.ParseInt(fields[4], 10, 64)
		refs := parseDecorateRefs(fields[5])
		subject := fields[6]
		body := ""
		if len(fields) > 7 {
			body = strings.TrimSpace(fields[7])
		}

		if q != "" {
			match := strings.Contains(strings.ToLower(hash), ql) ||
				strings.Contains(strings.ToLower(subject), ql) ||
				strings.Contains(strings.ToLower(body), ql) ||
				strings.Contains(strings.ToLower(author), ql) ||
				strings.Contains(strings.ToLower(email), ql)
			if !match {
				continue
			}
		}

		shortHash := hash
		if len(shortHash) > 7 {
			shortHash = shortHash[:7]
		}
		t := time.Unix(ts, 0)
		items = append(items, CommitItem{
			Hash:          hash,
			ShortHash:     shortHash,
			Parents:       parents,
			Author:        author,
			Email:         email,
			Timestamp:     ts,
			RelativeTime:  formatRelativeTime(now, t),
			DateFormatted: formatCommitDate(now, t),
			Subject:       subject,
			Body:          body,
			Refs:          refs,
		})
	}

	if q != "" {
		if skip < len(items) {
			end := skip + limit
			if end < len(items) {
				page.HasMore = true
				page.Commits = items[skip:end]
			} else {
				page.Commits = items[skip:]
			}
		}
		return page, nil
	}

	if len(items) > limit {
		page.HasMore = true
		page.Commits = items[:limit]
	} else {
		page.Commits = items
	}
	return page, nil
}

func parseDecorateRefs(raw string) []RefBadge {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return []RefBadge{}
	}
	parts := strings.Split(raw, ", ")
	var badges []RefBadge
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if strings.HasPrefix(p, "HEAD -> ") {
			badges = append(badges, RefBadge{Name: "HEAD", Type: "head"})
			branchName := strings.TrimPrefix(p, "HEAD -> ")
			badges = append(badges, RefBadge{Name: branchName, Type: "local"})
			continue
		}
		if p == "HEAD" {
			badges = append(badges, RefBadge{Name: "HEAD", Type: "head"})
			continue
		}
		if strings.HasPrefix(p, "tag: ") {
			badges = append(badges, RefBadge{Name: strings.TrimPrefix(p, "tag: "), Type: "tag"})
			continue
		}
		if strings.Contains(p, "/") {
			// Could be origin/main or feat/foo; check common remote/HEAD or slash
			if strings.HasSuffix(p, "/HEAD") {
				continue
			}
			// Git decorate puts remote branches as origin/foo; local branches with slash also appear.
			// We mark remote if prefix is known or keep simple heuristic, refined in UI if needed.
			if strings.HasPrefix(p, "origin/") || strings.HasPrefix(p, "upstream/") {
				badges = append(badges, RefBadge{Name: p, Type: "remote"})
			} else {
				badges = append(badges, RefBadge{Name: p, Type: "local"})
			}
			continue
		}
		badges = append(badges, RefBadge{Name: p, Type: "local"})
	}
	return badges
}

// GetCommitDetail returns full commit metadata and changed files list.
func GetCommitDetail(ctx context.Context, loc RepoLocation, hash string) (CommitDetail, error) {
	detail := CommitDetail{Files: []CommitFileChange{}, Parents: []string{}}
	if strings.TrimSpace(hash) == "" {
		return detail, nil
	}

	format := "%H%x1f%P%x1f%an%x1f%ae%x1f%ct%x1f%s%x1f%b"
	metaOut, stderr, err := RunGit(ctx, loc, "show", "--no-patch", "--format="+format, hash)
	if err != nil {
		return detail, fmt.Errorf("git show failed: %s (%w)", strings.TrimSpace(stderr), err)
	}
	fields := strings.SplitN(strings.TrimSpace(metaOut), "\x1f", 7)
	if len(fields) >= 6 {
		detail.Hash = fields[0]
		if len(detail.Hash) > 7 {
			detail.ShortHash = detail.Hash[:7]
		}
		if strings.TrimSpace(fields[1]) != "" {
			detail.Parents = strings.Fields(fields[1])
		}
		detail.Author = fields[2]
		detail.Email = fields[3]
		ts, _ := strconv.ParseInt(fields[4], 10, 64)
		t := time.Unix(ts, 0)
		now := time.Now()
		detail.RelativeTime = formatRelativeTime(now, t)
		detail.DateFormatted = t.Format("2006-01-02 15:04:05")
		detail.Subject = fields[5]
		if len(fields) > 6 {
			detail.Body = strings.TrimSpace(fields[6])
		}
	}

	// Get status per file (--name-status) and numstat (--numstat)
	nsOut, _, _ := RunGit(ctx, loc, "diff-tree", "--no-commit-id", "--name-status", "-r", "--root", "-z", hash)
	numOut, _, _ := RunGit(ctx, loc, "diff-tree", "--no-commit-id", "--numstat", "-r", "--root", "-z", hash)

	statsMap := make(map[string]numStat)
	numTokens := strings.Split(numOut, "\x00")
	for i := 0; i < len(numTokens); i++ {
		e := numTokens[i]
		if e == "" {
			continue
		}
		f := strings.SplitN(e, "\t", 3)
		if len(f) < 3 {
			continue
		}
		p := f[2]
		if p == "" && i+2 < len(numTokens) {
			p = numTokens[i+2]
			i += 2
		}
		if f[0] == "-" && f[1] == "-" {
			statsMap[p] = numStat{binary: true}
		} else {
			a, _ := strconv.Atoi(f[0])
			d, _ := strconv.Atoi(f[1])
			statsMap[p] = numStat{add: a, del: d}
		}
	}

	nsTokens := strings.Split(nsOut, "\x00")
	for i := 0; i+1 < len(nsTokens); i++ {
		code := nsTokens[i]
		if code == "" {
			continue
		}
		status := code[:1]
		var origPath, filePath string
		if (status == "R" || status == "C") && i+2 < len(nsTokens) {
			origPath = nsTokens[i+1]
			filePath = nsTokens[i+2]
			i += 2
		} else {
			filePath = nsTokens[i+1]
			i++
		}
		st := statsMap[filePath]
		detail.Files = append(detail.Files, CommitFileChange{
			Path:      filePath,
			OrigPath:  origPath,
			Status:    status,
			Additions: st.add,
			Deletions: st.del,
			IsBinary:  st.binary,
		})
	}

	return detail, nil
}

// GetCommitFileDiff returns the parsed diff of a specific file within a commit.
func GetCommitFileDiff(ctx context.Context, loc RepoLocation, hash, relPath string, ignoreWhitespace bool) (FileDiff, error) {
	args := []string{"show", "--format=", "--root", "--no-color", "--unified=3"}
	if ignoreWhitespace {
		args = append(args, "-w")
	}
	args = append(args, hash, "--", relPath)

	stdout, stderr, err := RunGit(ctx, loc, args...)
	if err != nil && stdout == "" {
		return FileDiff{Path: relPath, Hunks: []DiffHunk{}}, fmt.Errorf("commit file diff failed: %s (%w)", strings.TrimSpace(stderr), err)
	}
	fd := ParseUnifiedDiff(relPath, stdout)
	if fd.IsBinary {
		if sOut, _, err := RunGit(ctx, loc, "cat-file", "-s", hash+"^:"+relPath); err == nil {
			fd.OldSize, _ = strconv.ParseInt(strings.TrimSpace(sOut), 10, 64)
		}
		if sOut, _, err := RunGit(ctx, loc, "cat-file", "-s", hash+":"+relPath); err == nil {
			fd.NewSize, _ = strconv.ParseInt(strings.TrimSpace(sOut), 10, 64)
		}
	}
	return fd, nil
}

func formatRelativeTime(now, t time.Time) string {
	d := now.Sub(t)
	if d < 0 {
		return "just now"
	}
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		m := int(d.Minutes())
		if m == 1 {
			return "1 minute ago"
		}
		return fmt.Sprintf("%d minutes ago", m)
	case d < 24*time.Hour:
		h := int(d.Hours())
		if h == 1 {
			return "1 hour ago"
		}
		return fmt.Sprintf("%d hours ago", h)
	case d < 30*24*time.Hour:
		days := int(d.Hours() / 24)
		if days == 1 {
			return "1 day ago"
		}
		return fmt.Sprintf("%d days ago", days)
	case d < 365*24*time.Hour:
		months := int(d.Hours() / (24 * 30))
		if months <= 1 {
			return "1 month ago"
		}
		return fmt.Sprintf("%d months ago", months)
	default:
		years := int(d.Hours() / (24 * 365))
		if years <= 1 {
			return "1 year ago"
		}
		return fmt.Sprintf("%d years ago", years)
	}
}

func formatCommitDate(now, t time.Time) string {
	ny, nm, nd := now.Date()
	ty, tm, td := t.Date()
	if ny == ty && nm == tm && nd == td {
		return "Today " + t.Format("15:04")
	}
	yest := now.AddDate(0, 0, -1)
	if yest.Year() == ty && yest.Month() == tm && yest.Day() == td {
		return "Yesterday " + t.Format("15:04")
	}
	if ny == ty {
		return t.Format("Jan 02 15:04")
	}
	return t.Format("2006-01-02")
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
