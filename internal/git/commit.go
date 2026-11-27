package git

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
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

	stdout, stderr, err := RunGitOp(ctx, loc, args...)
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

// GetRecentCommitMessages returns recent unique commit messages (subject + body) from HEAD (or all refs if HEAD is unborn).
func GetRecentCommitMessages(ctx context.Context, loc RepoLocation, limit int) ([]RecentCommitMessage, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	fetchCount := limit * 2
	if fetchCount < 40 {
		fetchCount = 40
	}
	format := "%x1e%H%x1f%an%x1f%ct%x1f%s%x1f%b"
	stdout, stderr, err := RunGit(ctx, loc, "log", fmt.Sprintf("-n%d", fetchCount), "--format="+format, "HEAD", "--")
	if err != nil && isMissingRevisionErr(stderr) {
		stdout, stderr, err = RunGit(ctx, loc, "log", fmt.Sprintf("-n%d", fetchCount), "--exclude=refs/stash", "--all", "--format="+format, "--")
	}
	if err != nil {
		msg := strings.TrimSpace(stderr)
		if strings.Contains(msg, "does not have any commits yet") || strings.Contains(msg, "your current branch") {
			return []RecentCommitMessage{}, nil
		}
		return nil, fmt.Errorf("git log failed: %s (%w)", msg, err)
	}

	now := time.Now()
	seen := make(map[string]struct{})
	items := make([]RecentCommitMessage, 0, limit)
	for _, rec := range strings.Split(stdout, "\x1e") {
		rec = strings.TrimSpace(rec)
		if rec == "" {
			continue
		}
		fields := strings.SplitN(rec, "\x1f", 5)
		if len(fields) < 4 {
			continue
		}
		hash := strings.TrimSpace(fields[0])
		author := strings.TrimSpace(fields[1])
		ts, _ := strconv.ParseInt(strings.TrimSpace(fields[2]), 10, 64)
		subject := strings.TrimSpace(fields[3])
		body := ""
		if len(fields) > 4 {
			body = strings.TrimSpace(fields[4])
		}
		if subject == "" {
			continue
		}
		dedupeKey := subject + "\x00" + body
		if _, exists := seen[dedupeKey]; exists {
			continue
		}
		seen[dedupeKey] = struct{}{}

		shortHash := hash
		if len(shortHash) > 7 {
			shortHash = shortHash[:7]
		}
		items = append(items, RecentCommitMessage{
			Hash:         hash,
			ShortHash:    shortHash,
			Subject:      subject,
			Body:         body,
			Author:       author,
			RelativeTime: formatRelativeTime(now, time.Unix(ts, 0)),
		})
		if len(items) >= limit {
			break
		}
	}
	return items, nil
}

func parsePreparedCommitMsg(raw string) (string, string) {
	normalized := strings.ReplaceAll(raw, "\r\n", "\n")
	var kept []string
	for _, line := range strings.Split(normalized, "\n") {
		if strings.HasPrefix(strings.TrimLeft(line, " \t"), "#") {
			continue
		}
		kept = append(kept, line)
	}
	trimmed := strings.TrimSpace(strings.Join(kept, "\n"))
	if trimmed == "" {
		return "", ""
	}
	parts := strings.SplitN(trimmed, "\n", 2)
	summary := strings.TrimSpace(parts[0])
	desc := ""
	if len(parts) > 1 {
		desc = strings.TrimSpace(parts[1])
	}
	return summary, desc
}

// GetMergeCommitMessage returns Git's auto-generated commit subject & body for an in-progress merge, cherry-pick, or rebase.
func GetMergeCommitMessage(ctx context.Context, loc RepoLocation) (string, string, error) {
	for _, gitFile := range []string{"MERGE_MSG", "SQUASH_MSG", "rebase-merge/message"} {
		if raw, ok := readGitPathFile(ctx, loc, gitFile); ok {
			if sum, desc := parsePreparedCommitMsg(raw); sum != "" {
				return sum, desc, nil
			}
		}
	}

	state, branch := detectMergeState(ctx, loc)
	switch state {
	case "cherry-pick":
		if out, _, err := RunGit(ctx, loc, "log", "-1", "--format=%s%x1f%b", "CHERRY_PICK_HEAD"); err == nil {
			parts := strings.SplitN(out, "\x1f", 2)
			sum := strings.TrimSpace(parts[0])
			desc := ""
			if len(parts) > 1 {
				desc = strings.TrimSpace(parts[1])
			}
			if sum != "" {
				return sum, desc, nil
			}
		}
	case "merge":
		if branch != "" {
			branch = strings.TrimPrefix(branch, "remotes/")
			return fmt.Sprintf("Merge branch '%s'", branch), "", nil
		}
		return "Merge branch", "", nil
	}
	return "", "", nil
}

func isMissingRevisionErr(stderr string) bool {
	low := strings.ToLower(stderr)
	return strings.Contains(low, "unknown revision") ||
		strings.Contains(low, "bad revision") ||
		strings.Contains(low, "ambiguous argument")
}

func buildCommitLogArgs(format, ref, search string, skip, limit int) []string {
	args := []string{
		"log",
		"--date-order",
		fmt.Sprintf("--format=%s", format),
	}
	if search == "" {
		if skip > 0 {
			args = append(args, fmt.Sprintf("--skip=%d", skip))
		}
		if limit > 0 {
			args = append(args, fmt.Sprintf("-n%d", limit+1))
		}
	}
	if ref == "" || ref == "__ALL__" {
		args = append(args, "--exclude=refs/stash", "--all", "--")
	} else {
		args = append(args, ref, "--")
	}
	return args
}

// GetCommitHistory returns commits with parent hashes and ref badges.
// When limit <= 0, all matching commits are returned without pagination cap.
func GetCommitHistory(ctx context.Context, loc RepoLocation, branch string, search string, skip int, limit int) (CommitPage, error) {
	if skip < 0 {
		skip = 0
	}

	page := CommitPage{Commits: []CommitItem{}}
	// Use \x1e (record separator) and \x1f (unit separator)
	format := "%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%ct%x1f%D%x1f%s%x1f%b"
	b := strings.TrimSpace(branch)
	q := strings.TrimSpace(search)
	args := buildCommitLogArgs(format, b, q, skip, limit)

	stdout, stderr, err := RunGit(ctx, loc, args...)
	if err != nil && b != "" && b != "__ALL__" && isMissingRevisionErr(stderr) {
		// Stale or deleted branch/tag ref (e.g. deleted externally or during tab switch); fall back to --all.
		if _, _, rerr := RunGit(ctx, loc, "rev-parse", "--verify", "--quiet", b+"^{commit}"); rerr != nil {
			args = buildCommitLogArgs(format, "__ALL__", q, skip, limit)
			stdout, stderr, err = RunGit(ctx, loc, args...)
		}
	}
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
			if limit > 0 {
				end := skip + limit
				if end < len(items) {
					page.HasMore = true
					page.Commits = items[skip:end]
				} else {
					page.Commits = items[skip:]
				}
			} else {
				page.Commits = items[skip:]
			}
		}
		return page, nil
	}

	if limit > 0 && len(items) > limit {
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
			branchName := strings.TrimPrefix(strings.TrimPrefix(p, "HEAD -> "), "heads/")
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
		if strings.HasPrefix(p, "heads/") {
			badges = append(badges, RefBadge{Name: strings.TrimPrefix(p, "heads/"), Type: "local"})
			continue
		}
		if strings.HasPrefix(p, "remotes/") {
			rem := strings.TrimPrefix(p, "remotes/")
			if !strings.HasSuffix(rem, "/HEAD") {
				badges = append(badges, RefBadge{Name: rem, Type: "remote"})
			}
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

	// Get status per file (--name-status) and numstat (--numstat).
	// For merge commits (2+ parents), diff directly against the first parent (Parents[0])
	// because `git diff-tree -m --first-parent` still outputs diffs for all parents.
	var nsOut, numOut string
	if len(detail.Parents) >= 2 {
		nsOut, _, _ = RunGit(ctx, loc, "diff", "--name-status", "-z", detail.Parents[0], hash)
		numOut, _, _ = RunGit(ctx, loc, "diff", "--numstat", "-z", detail.Parents[0], hash)
	} else {
		nsOut, _, _ = RunGit(ctx, loc, "diff-tree", "--no-commit-id", "--name-status", "-r", "--root", "-z", hash)
		numOut, _, _ = RunGit(ctx, loc, "diff-tree", "--no-commit-id", "--numstat", "-r", "--root", "-z", hash)
	}

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
	args := []string{"show", "-m", "--first-parent", "--format=", "--root", "--no-color", "--unified=3"}
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
	if d < time.Minute {
		return "刚刚"
	}
	switch {
	case d < time.Hour:
		return fmt.Sprintf("%d 分钟前", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%d 小时前", int(d.Hours()))
	case d < 30*24*time.Hour:
		return fmt.Sprintf("%d 天前", int(d.Hours()/24))
	case d < 365*24*time.Hour:
		months := int(d.Hours() / (24 * 30))
		if months < 1 {
			months = 1
		}
		return fmt.Sprintf("%d 个月前", months)
	default:
		years := int(d.Hours() / (24 * 365))
		if years < 1 {
			years = 1
		}
		return fmt.Sprintf("%d 年前", years)
	}
}

func formatCommitDate(now, t time.Time) string {
	_ = now
	return t.Format("2006-01-02 15:04:05")
}

// RevertCommit reverts a specific commit (--no-edit, and -m 1 for merge commits).
func RevertCommit(ctx context.Context, loc RepoLocation, hash string, isMerge bool) (OpResult, error) {
	hash = strings.TrimSpace(hash)
	if hash == "" {
		return OpResult{Success: false, Message: "Commit hash is required"}, nil
	}
	args := []string{"revert", "--no-edit"}
	if isMerge {
		args = append(args, "-m", "1")
	}
	args = append(args, hash)

	stdout, stderr, err := RunGitOp(ctx, loc, args...)
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		low := strings.ToLower(combined)
		code := ""
		if strings.Contains(low, "conflict") || strings.Contains(low, "could not revert") {
			code = "CONFLICT"
		}
		return OpResult{
			Success:   false,
			Message:   firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()),
			ErrorCode: code,
			Output:    combined,
		}, nil
	}
	short := hash
	if len(short) > 7 {
		short = short[:7]
	}
	return OpResult{Success: true, Message: "Reverted commit " + short, Output: combined}, nil
}

// ResetToCommit resets the current branch HEAD to the specified commit with mode soft, mixed, or hard.
func ResetToCommit(ctx context.Context, loc RepoLocation, hash, mode string) (OpResult, error) {
	hash = strings.TrimSpace(hash)
	if hash == "" {
		return OpResult{Success: false, Message: "Commit hash is required"}, nil
	}
	flag := "--mixed"
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "soft":
		flag = "--soft"
	case "hard":
		flag = "--hard"
	case "mixed", "":
		flag = "--mixed"
	default:
		return OpResult{Success: false, Message: "Invalid reset mode: " + mode}, nil
	}

	stdout, stderr, err := RunGitOp(ctx, loc, "reset", flag, hash)
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		return OpResult{
			Success: false,
			Message: firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()),
			Output:  combined,
		}, nil
	}
	short := hash
	if len(short) > 7 {
		short = short[:7]
	}
	return OpResult{
		Success: true,
		Message: fmt.Sprintf("Reset (%s) to %s", strings.TrimPrefix(flag, "--"), short),
		Output:  combined,
	}, nil
}

// GetCommitTree returns all tracked files and their sizes at a specific commit snapshot.
func GetCommitTree(ctx context.Context, loc RepoLocation, hash string) ([]CommitTreeEntry, error) {
	hash = strings.TrimSpace(hash)
	if hash == "" {
		return []CommitTreeEntry{}, nil
	}
	out, stderr, err := RunGit(ctx, loc, "ls-tree", "-r", "-l", "-z", hash)
	if err != nil {
		return nil, fmt.Errorf("git ls-tree failed: %s (%w)", strings.TrimSpace(stderr), err)
	}
	entries := []CommitTreeEntry{}
	for _, rec := range strings.Split(out, "\x00") {
		if rec == "" {
			continue
		}
		// Format: <mode> <type> <object> <size>\t<path>
		tabIdx := strings.IndexByte(rec, '\t')
		if tabIdx < 0 {
			continue
		}
		meta := strings.Fields(rec[:tabIdx])
		filePath := rec[tabIdx+1:]
		if len(meta) < 4 {
			continue
		}
		var sz int64
		if meta[3] != "-" {
			sz, _ = strconv.ParseInt(meta[3], 10, 64)
		}
		entries = append(entries, CommitTreeEntry{
			Path: filePath,
			Size: sz,
		})
	}
	return entries, nil
}

// GetCommitFileContent returns file content (up to 512 KB) or binary metadata at a specific commit.
func GetCommitFileContent(ctx context.Context, loc RepoLocation, hash, relPath string) (CommitFileContent, error) {
	res := CommitFileContent{Path: relPath}
	spec := strings.TrimSpace(hash) + ":" + relPath

	if szOut, _, err := RunGit(ctx, loc, "cat-file", "-s", spec); err == nil {
		res.Size, _ = strconv.ParseInt(strings.TrimSpace(szOut), 10, 64)
	}

	var cmd *exec.Cmd
	if loc.IsWSL {
		cmd = exec.CommandContext(ctx, "wsl.exe", "-d", loc.Distro, "--cd", loc.LinuxPath, "-e", "git", "cat-file", "blob", spec)
	} else {
		cmd = exec.CommandContext(ctx, "git", "cat-file", "blob", spec)
		cmd.Dir = loc.Path
	}
	cmd.Env = append(os.Environ(), "LC_ALL=C.UTF-8")
	hideWindow(cmd)

	raw, err := cmd.Output()
	if err != nil {
		res.RawError = fmt.Sprintf("Failed to read file at %s: %v", hash, err)
		return res, nil
	}

	const maxPreview = 512 * 1024
	checkLen := len(raw)
	if checkLen > 8192 {
		checkLen = 8192
	}
	if bytes.IndexByte(raw[:checkLen], 0) >= 0 {
		res.IsBinary = true
		return res, nil
	}
	if len(raw) > maxPreview {
		raw = raw[:maxPreview]
		res.Truncated = true
	}
	res.Content = strings.ReplaceAll(string(raw), "\r\n", "\n")
	return res, nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
