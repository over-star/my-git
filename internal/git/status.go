package git

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strconv"
	"strings"
)

// GetRepoStatus returns staged, unstaged, conflicted files and branch tracking metadata.
func GetRepoStatus(ctx context.Context, loc RepoLocation) (RepoStatus, error) {
	st := RepoStatus{
		Unstaged:   []FileStatus{},
		Staged:     []FileStatus{},
		Conflicted: []FileStatus{},
	}

	out, stderr, err := RunGit(ctx, loc, "status", "--porcelain=v2", "--branch", "-z", "-uall")
	if err != nil {
		return st, fmt.Errorf("git status failed: %s (%w)", strings.TrimSpace(stderr), err)
	}

	// Collect numstats for unstaged and staged
	unstagedStats := parseNumstat(ctx, loc, false)
	stagedStats := parseNumstat(ctx, loc, true)

	tokens := strings.Split(out, "\x00")
	for i := 0; i < len(tokens); i++ {
		line := tokens[i]
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "# ") {
			parseBranchHeader(&st, line)
			continue
		}

		switch line[0] {
		case '1': // Ordinary changed entry: 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
			fields := strings.SplitN(line, " ", 9)
			if len(fields) < 9 {
				continue
			}
			xy := fields[1]
			filePath := fields[8]
			x, y := xy[0], xy[1]
			if x != '.' {
				stat := stagedStats[filePath]
				st.Staged = append(st.Staged, FileStatus{
					Path:      filePath,
					Status:    string(x),
					Staged:    true,
					Additions: stat.add,
					Deletions: stat.del,
					IsBinary:  stat.binary,
				})
			}
			if y != '.' {
				stat := unstagedStats[filePath]
				st.Unstaged = append(st.Unstaged, FileStatus{
					Path:      filePath,
					Status:    string(y),
					Staged:    false,
					Additions: stat.add,
					Deletions: stat.del,
					IsBinary:  stat.binary,
				})
			}
		case '2': // Renamed or copied entry: 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\0<origPath>
			fields := strings.SplitN(line, " ", 10)
			if len(fields) < 10 {
				continue
			}
			xy := fields[1]
			filePath := fields[9]
			origPath := ""
			if i+1 < len(tokens) {
				i++
				origPath = tokens[i]
			}
			x, y := xy[0], xy[1]
			if x != '.' {
				stat := stagedStats[filePath]
				st.Staged = append(st.Staged, FileStatus{
					Path:      filePath,
					OrigPath:  origPath,
					Status:    string(x),
					Staged:    true,
					Additions: stat.add,
					Deletions: stat.del,
					IsBinary:  stat.binary,
				})
			}
			if y != '.' {
				stat := unstagedStats[filePath]
				st.Unstaged = append(st.Unstaged, FileStatus{
					Path:      filePath,
					OrigPath:  origPath,
					Status:    string(y),
					Staged:    false,
					Additions: stat.add,
					Deletions: stat.del,
					IsBinary:  stat.binary,
				})
			}
		case 'u': // Unmerged (conflicted): u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
			fields := strings.SplitN(line, " ", 11)
			if len(fields) < 11 {
				continue
			}
			filePath := fields[10]
			item := FileStatus{
				Path:       filePath,
				Status:     "U",
				Staged:     false,
				Conflicted: true,
			}
			st.Conflicted = append(st.Conflicted, item)
			st.Unstaged = append(st.Unstaged, item)
		case '?': // Untracked: ? <path>
			if len(line) > 2 {
				filePath := line[2:]
				st.Unstaged = append(st.Unstaged, FileStatus{
					Path:   filePath,
					Status: "?",
					Staged: false,
				})
			}
		}
	}

	st.MergeState, st.MergeBranch = detectMergeState(ctx, loc)
	return st, nil
}

func parseBranchHeader(st *RepoStatus, line string) {
	switch {
	case strings.HasPrefix(line, "# branch.oid "):
		oid := strings.TrimPrefix(line, "# branch.oid ")
		if oid != "(initial)" && len(oid) >= 7 {
			st.HeadSHA = oid[:7]
		}
	case strings.HasPrefix(line, "# branch.head "):
		head := strings.TrimPrefix(line, "# branch.head ")
		if head == "(detached)" {
			st.IsDetached = true
			st.Branch = "HEAD detached"
		} else {
			st.Branch = head
		}
	case strings.HasPrefix(line, "# branch.upstream "):
		st.Upstream = strings.TrimPrefix(line, "# branch.upstream ")
	case strings.HasPrefix(line, "# branch.ab "):
		parts := strings.Fields(strings.TrimPrefix(line, "# branch.ab "))
		for _, p := range parts {
			if strings.HasPrefix(p, "+") {
				st.Ahead, _ = strconv.Atoi(p[1:])
			} else if strings.HasPrefix(p, "-") {
				st.Behind, _ = strconv.Atoi(p[1:])
			}
		}
	}
}

type numStat struct {
	add    int
	del    int
	binary bool
}

func parseNumstat(ctx context.Context, loc RepoLocation, cached bool) map[string]numStat {
	res := make(map[string]numStat)
	args := []string{"diff", "--numstat", "-z"}
	if cached {
		args = []string{"diff", "--cached", "--numstat", "-z"}
	}
	out, _, err := RunGit(ctx, loc, args...)
	if err != nil || out == "" {
		return res
	}
	parts := strings.Split(out, "\x00")
	for i := 0; i < len(parts); i++ {
		entry := parts[i]
		if entry == "" {
			continue
		}
		fields := strings.SplitN(entry, "\t", 3)
		if len(fields) < 3 {
			continue
		}
		filePath := fields[2]
		// For renames with -z, path field is empty and followed by old\0new\0
		if filePath == "" && i+2 < len(parts) {
			filePath = parts[i+2]
			i += 2
		}
		if fields[0] == "-" && fields[1] == "-" {
			res[filePath] = numStat{binary: true}
		} else {
			a, _ := strconv.Atoi(fields[0])
			d, _ := strconv.Atoi(fields[1])
			res[filePath] = numStat{add: a, del: d}
		}
	}
	return res
}

func detectMergeState(ctx context.Context, loc RepoLocation) (string, string) {
	checks := []struct {
		file  string
		state string
	}{
		{"MERGE_HEAD", "merge"},
		{"rebase-merge", "rebase"},
		{"rebase-apply", "rebase"},
		{"CHERRY_PICK_HEAD", "cherry-pick"},
	}
	for _, c := range checks {
		pOut, _, err := RunGit(ctx, loc, "rev-parse", "--git-path", c.file)
		if err != nil {
			continue
		}
		gitRel := strings.TrimSpace(pOut)
		if gitRel == "" {
			continue
		}
		if gitPathExists(ctx, loc, gitRel) {
			msg := ""
			if c.state == "merge" {
				if mOut, _, merr := RunGit(ctx, loc, "name-rev", "--name-only", "MERGE_HEAD"); merr == nil {
					msg = strings.TrimSpace(mOut)
				}
			}
			return c.state, msg
		}
	}
	return "", ""
}

func gitPathExists(ctx context.Context, loc RepoLocation, relOrAbs string) bool {
	if loc.IsWSL {
		target := relOrAbs
		if !strings.HasPrefix(target, "/") {
			target = path.Join(loc.LinuxPath, target)
		}
		cmd := exec.CommandContext(ctx, "wsl.exe", "-d", loc.Distro, "--", "test", "-e", target)
		hideWindow(cmd)
		return cmd.Run() == nil
	}
	target := relOrAbs
	if !filepath.IsAbs(target) {
		target = filepath.Join(loc.Path, filepath.FromSlash(target))
	}
	_, err := os.Stat(target)
	return err == nil
}

// StageFile stages a single file.
func StageFile(ctx context.Context, loc RepoLocation, relPath string) error {
	_, stderr, err := RunGit(ctx, loc, "add", "--", relPath)
	if err != nil {
		return fmt.Errorf("stage failed: %s (%w)", strings.TrimSpace(stderr), err)
	}
	return nil
}

// UnstageFile unstages a single file.
func UnstageFile(ctx context.Context, loc RepoLocation, relPath string) error {
	// Check if HEAD exists; on initial commit without HEAD use git rm --cached
	_, _, headErr := RunGit(ctx, loc, "rev-parse", "--verify", "HEAD")
	var stderr string
	var err error
	if headErr != nil {
		_, stderr, err = RunGit(ctx, loc, "rm", "--cached", "-r", "--", relPath)
	} else {
		_, stderr, err = RunGit(ctx, loc, "reset", "HEAD", "--", relPath)
	}
	if err != nil {
		return fmt.Errorf("unstage failed: %s (%w)", strings.TrimSpace(stderr), err)
	}
	return nil
}

// StageAll stages all working tree changes including untracked files.
func StageAll(ctx context.Context, loc RepoLocation) error {
	_, stderr, err := RunGit(ctx, loc, "add", "-A")
	if err != nil {
		return fmt.Errorf("stage all failed: %s (%w)", strings.TrimSpace(stderr), err)
	}
	return nil
}

// UnstageAll unstages all staged changes.
func UnstageAll(ctx context.Context, loc RepoLocation) error {
	_, _, headErr := RunGit(ctx, loc, "rev-parse", "--verify", "HEAD")
	var stderr string
	var err error
	if headErr != nil {
		_, stderr, err = RunGit(ctx, loc, "rm", "--cached", "-r", ".")
	} else {
		_, stderr, err = RunGit(ctx, loc, "reset", "HEAD")
	}
	if err != nil {
		return fmt.Errorf("unstage all failed: %s (%w)", strings.TrimSpace(stderr), err)
	}
	return nil
}

// DiscardFile discards unstaged modifications or deletes an untracked file.
func DiscardFile(ctx context.Context, loc RepoLocation, relPath string, isUntracked bool) error {
	if isUntracked {
		_, stderr, err := RunGit(ctx, loc, "clean", "-f", "-d", "--", relPath)
		if err != nil {
			return fmt.Errorf("failed to remove untracked file: %s (%w)", strings.TrimSpace(stderr), err)
		}
		return nil
	}
	_, stderr, err := RunGit(ctx, loc, "checkout", "--", relPath)
	if err != nil {
		return fmt.Errorf("discard failed: %s (%w)", strings.TrimSpace(stderr), err)
	}
	return nil
}

// GetWorkingDiff returns parsed diff hunks (or binary metadata) for a staged, unstaged, or untracked file.
func GetWorkingDiff(ctx context.Context, loc RepoLocation, relPath string, staged bool, isUntracked bool, ignoreWhitespace bool) (FileDiff, error) {
	fd := FileDiff{Path: relPath, Hunks: []DiffHunk{}}

	if isUntracked && !staged {
		return buildUntrackedDiff(ctx, loc, relPath)
	}

	args := []string{"diff", "--no-color", "--unified=3"}
	if ignoreWhitespace {
		args = append(args, "-w")
	}
	if staged {
		args = append(args, "--cached")
	}
	args = append(args, "--", relPath)

	stdout, stderr, err := RunGit(ctx, loc, args...)
	if err != nil && stdout == "" {
		return fd, fmt.Errorf("git diff failed: %s (%w)", strings.TrimSpace(stderr), err)
	}

	fd = ParseUnifiedDiff(relPath, stdout)
	if fd.IsBinary {
		fd.OldSize, fd.NewSize = getWorkingBinarySizes(ctx, loc, relPath, staged)
	}
	return fd, nil
}

func buildUntrackedDiff(ctx context.Context, loc RepoLocation, relPath string) (FileDiff, error) {
	fd := FileDiff{Path: relPath, Hunks: []DiffHunk{}}
	raw, size, err := readRepoFileBytes(ctx, loc, relPath, 512*1024)
	if err != nil {
		fd.RawError = err.Error()
		return fd, nil
	}
	fd.NewSize = size
	// Check for binary NUL byte
	checkLen := len(raw)
	if checkLen > 8192 {
		checkLen = 8192
	}
	if bytes.IndexByte(raw[:checkLen], 0) >= 0 {
		fd.IsBinary = true
		return fd, nil
	}
	if size > 512*1024 {
		fd.Truncated = true
	}

	text := strings.ReplaceAll(string(raw), "\r\n", "\n")
	lines := strings.Split(text, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	hunk := DiffHunk{
		Header:   fmt.Sprintf("@@ -0,0 +1,%d @@ (untracked file)", len(lines)),
		OldStart: 0,
		OldCount: 0,
		NewStart: 1,
		NewCount: len(lines),
		Lines:    make([]DiffLine, 0, len(lines)),
	}
	for i, l := range lines {
		hunk.Lines = append(hunk.Lines, DiffLine{
			Type:    "add",
			NewLine: i + 1,
			Content: l,
		})
	}
	fd.Additions = len(lines)
	fd.Hunks = []DiffHunk{hunk}
	return fd, nil
}

func readRepoFileBytes(ctx context.Context, loc RepoLocation, relPath string, maxBytes int64) ([]byte, int64, error) {
	if loc.IsWSL {
		target := path.Join(loc.LinuxPath, relPath)
		sizeCmd := exec.CommandContext(ctx, "wsl.exe", "-d", loc.Distro, "--", "stat", "-c", "%s", target)
		hideWindow(sizeCmd)
		sOut, err := sizeCmd.Output()
		if err != nil {
			return nil, 0, fmt.Errorf("cannot stat file: %w", err)
		}
		size, _ := strconv.ParseInt(strings.TrimSpace(string(sOut)), 10, 64)
		readCmd := exec.CommandContext(ctx, "wsl.exe", "-d", loc.Distro, "--", "head", "-c", strconv.FormatInt(maxBytes, 10), target)
		hideWindow(readCmd)
		data, err := readCmd.Output()
		return data, size, err
	}

	fullPath := filepath.Join(loc.Path, filepath.FromSlash(relPath))
	info, err := os.Stat(fullPath)
	if err != nil {
		return nil, 0, err
	}
	f, err := os.Open(fullPath)
	if err != nil {
		return nil, info.Size(), err
	}
	defer f.Close()
	buf := make([]byte, maxBytes)
	n, _ := f.Read(buf)
	return buf[:n], info.Size(), nil
}

func getWorkingBinarySizes(ctx context.Context, loc RepoLocation, relPath string, staged bool) (int64, int64) {
	var oldSize, newSize int64
	if sOut, _, err := RunGit(ctx, loc, "cat-file", "-s", "HEAD:"+relPath); err == nil {
		oldSize, _ = strconv.ParseInt(strings.TrimSpace(sOut), 10, 64)
	}
	if staged {
		if sOut, _, err := RunGit(ctx, loc, "cat-file", "-s", ":"+relPath); err == nil {
			newSize, _ = strconv.ParseInt(strings.TrimSpace(sOut), 10, 64)
		}
	} else {
		if _, sz, err := readRepoFileBytes(ctx, loc, relPath, 1); err == nil {
			newSize = sz
		}
	}
	return oldSize, newSize
}

// ParseUnifiedDiff parses standard git unified diff text into structured hunks and lines.
func ParseUnifiedDiff(relPath string, raw string) FileDiff {
	fd := FileDiff{
		Path:  relPath,
		Hunks: []DiffHunk{},
	}
	if strings.TrimSpace(raw) == "" {
		return fd
	}

	lines := strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	var currentHunk *DiffHunk
	oldLine, newLine := 0, 0

	for _, line := range lines {
		if strings.HasPrefix(line, "Binary files ") || strings.HasPrefix(line, "GIT binary patch") {
			fd.IsBinary = true
			return fd
		}
		if strings.HasPrefix(line, "rename from ") {
			fd.OldPath = strings.TrimPrefix(line, "rename from ")
			continue
		}
		if strings.HasPrefix(line, "diff --git ") ||
			strings.HasPrefix(line, "index ") ||
			strings.HasPrefix(line, "old mode ") ||
			strings.HasPrefix(line, "new mode ") ||
			strings.HasPrefix(line, "new file mode ") ||
			strings.HasPrefix(line, "deleted file mode ") ||
			strings.HasPrefix(line, "similarity index ") ||
			strings.HasPrefix(line, "rename to ") ||
			strings.HasPrefix(line, "--- ") ||
			strings.HasPrefix(line, "+++ ") {
			continue
		}

		if strings.HasPrefix(line, "@@ ") {
			if currentHunk != nil {
				fd.Hunks = append(fd.Hunks, *currentHunk)
			}
			os, oc, ns, nc := parseHunkHeader(line)
			oldLine = os
			newLine = ns
			currentHunk = &DiffHunk{
				Header:   line,
				OldStart: os,
				OldCount: oc,
				NewStart: ns,
				NewCount: nc,
				Lines:    []DiffLine{},
			}
			continue
		}

		if currentHunk == nil {
			continue
		}
		if line == `\ No newline at end of file` {
			continue
		}
		if len(line) == 0 {
			currentHunk.Lines = append(currentHunk.Lines, DiffLine{
				Type:    "context",
				OldLine: oldLine,
				NewLine: newLine,
				Content: "",
			})
			oldLine++
			newLine++
			continue
		}

		switch line[0] {
		case '+':
			currentHunk.Lines = append(currentHunk.Lines, DiffLine{
				Type:    "add",
				NewLine: newLine,
				Content: line[1:],
			})
			newLine++
			fd.Additions++
		case '-':
			currentHunk.Lines = append(currentHunk.Lines, DiffLine{
				Type:    "del",
				OldLine: oldLine,
				Content: line[1:],
			})
			oldLine++
			fd.Deletions++
		case ' ':
			currentHunk.Lines = append(currentHunk.Lines, DiffLine{
				Type:    "context",
				OldLine: oldLine,
				NewLine: newLine,
				Content: line[1:],
			})
			oldLine++
			newLine++
		}
	}

	if currentHunk != nil {
		fd.Hunks = append(fd.Hunks, *currentHunk)
	}
	return fd
}

func parseHunkHeader(header string) (int, int, int, int) {
	// Format: @@ -oldStart,oldCount +newStart,newCount @@ optional context
	end := strings.Index(header[3:], " @@")
	if end < 0 {
		return 1, 0, 1, 0
	}
	rangePart := strings.TrimSpace(header[3 : 3+end])
	parts := strings.Fields(rangePart)
	if len(parts) < 2 {
		return 1, 0, 1, 0
	}
	os, oc := parseRange(strings.TrimPrefix(parts[0], "-"))
	ns, nc := parseRange(strings.TrimPrefix(parts[1], "+"))
	return os, oc, ns, nc
}

func parseRange(r string) (int, int) {
	if idx := strings.IndexByte(r, ','); idx >= 0 {
		s, _ := strconv.Atoi(r[:idx])
		c, _ := strconv.Atoi(r[idx+1:])
		return s, c
	}
	s, _ := strconv.Atoi(r)
	return s, 1
}
