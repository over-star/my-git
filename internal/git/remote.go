package git

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

var percentRe = regexp.MustCompile(`(\d{1,3})%`)

// Fetch runs git fetch --all --prune.
func Fetch(ctx context.Context, loc RepoLocation) (OpResult, error) {
	stdout, stderr, err := RunGit(ctx, loc, "fetch", "--all", "--prune")
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		return OpResult{
			Success: false,
			Message: firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()),
			Output:  combined,
		}, nil
	}
	return OpResult{Success: true, Message: "Fetch completed", Output: combined}, nil
}

// Pull runs git pull and reports merge conflicts clearly.
func Pull(ctx context.Context, loc RepoLocation) (OpResult, error) {
	stdout, stderr, err := RunGit(ctx, loc, "pull")
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		low := strings.ToLower(combined)
		code := ""
		if strings.Contains(low, "conflict") || strings.Contains(low, "automatic merge failed") {
			code = "CONFLICT"
		} else if strings.Contains(low, "no tracking information") {
			code = "NO_UPSTREAM"
		}
		return OpResult{
			Success:   false,
			Message:   firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()),
			ErrorCode: code,
			Output:    combined,
		}, nil
	}
	return OpResult{Success: true, Message: "Pull completed", Output: combined}, nil
}

// resolveDefaultRemote picks preferred if non-empty, otherwise "origin" when present or the first configured remote.
func resolveDefaultRemote(ctx context.Context, loc RepoLocation, preferred string) string {
	if p := strings.TrimSpace(preferred); p != "" {
		return p
	}
	if rOut, _, rerr := RunGit(ctx, loc, "remote"); rerr == nil {
		remotes := strings.Fields(rOut)
		if len(remotes) > 0 {
			for _, r := range remotes {
				if r == "origin" {
					return "origin"
				}
			}
			return remotes[0]
		}
	}
	return "origin"
}

func classifyPushError(ctx context.Context, loc RepoLocation, remoteName, stdout, stderr string, err error) OpResult {
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	code := ""
	remotes, _ := ListRemotes(ctx, loc)
	for _, r := range remotes {
		if remoteName != "" && r.Name != remoteName {
			continue
		}
		if strings.HasPrefix(strings.ToLower(r.PushURL), "http://") ||
			strings.HasPrefix(strings.ToLower(r.PushURL), "https://") {
			code = "HTTPS_REMOTE"
			break
		}
	}
	return OpResult{
		Success:   false,
		Message:   firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()),
		ErrorCode: code,
		Output:    combined,
	}
}

// Push runs git push, automatically adding --set-upstream origin <branch> when no upstream is set.
func Push(ctx context.Context, loc RepoLocation) (OpResult, error) {
	branchOut, _, berr := RunGit(ctx, loc, "rev-parse", "--abbrev-ref", "HEAD")
	currentBranch := strings.TrimSpace(branchOut)
	if berr != nil || currentBranch == "" || currentBranch == "HEAD" {
		return OpResult{Success: false, Message: "Cannot push from detached HEAD"}, nil
	}

	// Check if upstream exists
	_, _, uerr := RunGit(ctx, loc, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
	var args []string
	remoteName := ""
	if uerr != nil {
		remoteName = resolveDefaultRemote(ctx, loc, "")
		args = []string{"push", "--set-upstream", remoteName, currentBranch}
	} else {
		args = []string{"push"}
	}

	stdout, stderr, err := RunGit(ctx, loc, args...)
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		return classifyPushError(ctx, loc, remoteName, stdout, stderr, err), nil
	}
	msg := "Push completed"
	if uerr != nil {
		msg = fmt.Sprintf("Pushed and set upstream to %s", currentBranch)
	}
	return OpResult{Success: true, Message: msg, Output: combined}, nil
}

// ListRemotes returns configured git remotes and their fetch/push URLs.
func ListRemotes(ctx context.Context, loc RepoLocation) ([]RemoteInfo, error) {
	out, stderr, err := RunGit(ctx, loc, "remote", "-v")
	if err != nil {
		return nil, fmt.Errorf("failed to list remotes: %s (%w)", strings.TrimSpace(stderr), err)
	}
	order := []string{}
	byName := make(map[string]*RemoteInfo)
	for _, line := range strings.Split(strings.ReplaceAll(out, "\r\n", "\n"), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		name, urlStr, kind := fields[0], fields[1], fields[2]
		ri, ok := byName[name]
		if !ok {
			ri = &RemoteInfo{Name: name}
			byName[name] = ri
			order = append(order, name)
		}
		if strings.Contains(kind, "fetch") {
			ri.FetchURL = urlStr
		}
		if strings.Contains(kind, "push") {
			ri.PushURL = urlStr
		}
		low := strings.ToLower(urlStr)
		if strings.HasPrefix(low, "git@") || strings.HasPrefix(low, "ssh://") {
			ri.IsSSH = true
		}
	}
	res := make([]RemoteInfo, 0, len(order))
	for _, n := range order {
		res = append(res, *byName[n])
	}
	return res, nil
}

// SetRemoteURL updates (or adds) a remote URL.
func SetRemoteURL(ctx context.Context, loc RepoLocation, name, newURL string) (OpResult, error) {
	name = strings.TrimSpace(name)
	newURL = strings.TrimSpace(newURL)
	if name == "" || newURL == "" {
		return OpResult{Success: false, Message: "Remote name and URL are required"}, nil
	}
	// Check if remote exists
	_, _, checkErr := RunGit(ctx, loc, "remote", "get-url", name)
	var stdout, stderr string
	var err error
	if checkErr != nil {
		stdout, stderr, err = RunGit(ctx, loc, "remote", "add", name, newURL)
	} else {
		stdout, stderr, err = RunGit(ctx, loc, "remote", "set-url", name, newURL)
	}
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		return OpResult{
			Success: false,
			Message: firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()),
			Output:  combined,
		}, nil
	}
	return OpResult{
		Success: true,
		Message: fmt.Sprintf("Updated remote %s -> %s", name, newURL),
		Output:  combined,
	}, nil
}

// CloneRepo executes git clone --progress and streams progress events via callback.
func CloneRepo(ctx context.Context, cloneID, repoURL, targetParent, folderName string, onProgress func(CloneProgressEvent)) (RepoLocation, error) {
	repoURL = strings.TrimSpace(repoURL)
	if repoURL == "" {
		return RepoLocation{}, fmt.Errorf("repository URL is required")
	}

	if strings.TrimSpace(folderName) == "" {
		folderName = inferRepoNameFromURL(repoURL)
	}

	parentLoc := ParseRepoLocation(targetParent)
	var destLoc RepoLocation
	var cmd *exec.Cmd

	if parentLoc.IsWSL {
		targetLinux := path.Join(parentLoc.LinuxPath, folderName)
		destLoc = ParseRepoLocation(fmt.Sprintf("wsl://%s%s", parentLoc.Distro, targetLinux))
		// Ensure parent dir exists
		mk := exec.CommandContext(ctx, "wsl.exe", "-d", parentLoc.Distro, "-e", "mkdir", "-p", parentLoc.LinuxPath)
		hideWindow(mk)
		_ = mk.Run()

		sshCmd := resolveDefaultSSHCommand(ctx, parentLoc, true)
		cmd = exec.CommandContext(ctx, "wsl.exe", "-d", parentLoc.Distro, "-e", "git", "clone", "--progress", repoURL, targetLinux)
		env := append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "LC_ALL=C.UTF-8")
		wslEnv := "GIT_TERMINAL_PROMPT/u:LC_ALL/u"
		if sshCmd != "" {
			env = append(env, "GIT_SSH_COMMAND="+sshCmd)
			wslEnv += ":GIT_SSH_COMMAND/u"
		}
		cmd.Env = append(env, "WSLENV="+wslEnv)
	} else {
		if err := os.MkdirAll(parentLoc.Path, 0o755); err != nil {
			return RepoLocation{}, fmt.Errorf("failed to create parent directory: %w", err)
		}
		targetWin := filepath.Join(parentLoc.Path, folderName)
		destLoc = ParseRepoLocation(targetWin)
		sshCmd := resolveDefaultSSHCommand(ctx, parentLoc, true)
		cmd = exec.CommandContext(ctx, "git", "clone", "--progress", repoURL, targetWin)
		env := append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "LC_ALL=C.UTF-8")
		if sshCmd != "" {
			env = append(env, "GIT_SSH_COMMAND="+sshCmd)
		}
		cmd.Env = env
	}
	hideWindow(cmd)

	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return RepoLocation{}, err
	}
	if err := cmd.Start(); err != nil {
		return RepoLocation{}, err
	}

	var lastLines []string
	reader := bufio.NewReader(stderrPipe)
	var tokenBuf strings.Builder

	emitLine := func(line string) {
		line = strings.TrimSpace(line)
		if line == "" {
			return
		}
		lastLines = append(lastLines, line)
		if len(lastLines) > 20 {
			lastLines = lastLines[len(lastLines)-20:]
		}
		pct := 0
		if m := percentRe.FindStringSubmatch(line); len(m) == 2 {
			pct, _ = strconv.Atoi(m[1])
		}
		stage := "Cloning"
		switch {
		case strings.Contains(line, "Counting objects"):
			stage = "Counting objects"
		case strings.Contains(line, "Compressing objects"):
			stage = "Compressing objects"
		case strings.Contains(line, "Receiving objects"):
			stage = "Receiving objects"
		case strings.Contains(line, "Resolving deltas"):
			stage = "Resolving deltas"
		case strings.Contains(line, "Updating files"):
			stage = "Updating files"
		}
		if onProgress != nil {
			onProgress(CloneProgressEvent{
				ID:      cloneID,
				Stage:   stage,
				Percent: pct,
				Message: line,
			})
		}
	}

	buf := make([]byte, 1024)
	for {
		n, rerr := reader.Read(buf)
		if n > 0 {
			for _, b := range buf[:n] {
				if b == '\r' || b == '\n' {
					emitLine(tokenBuf.String())
					tokenBuf.Reset()
				} else {
					tokenBuf.WriteByte(b)
				}
			}
		}
		if rerr != nil {
			if rerr != io.EOF {
				emitLine(tokenBuf.String())
			}
			break
		}
	}
	if tokenBuf.Len() > 0 {
		emitLine(tokenBuf.String())
	}

	if err := cmd.Wait(); err != nil {
		errMsg := strings.Join(lastLines, "\n")
		if errMsg == "" {
			errMsg = err.Error()
		}
		if onProgress != nil {
			onProgress(CloneProgressEvent{
				ID:      cloneID,
				Stage:   "Failed",
				Percent: 0,
				Message: errMsg,
				Done:    true,
				Error:   errMsg,
			})
		}
		return RepoLocation{}, fmt.Errorf("git clone failed: %s", errMsg)
	}

	if onProgress != nil {
		onProgress(CloneProgressEvent{
			ID:      cloneID,
			Stage:   "Completed",
			Percent: 100,
			Message: "Repository cloned successfully",
			Done:    true,
		})
	}
	return ValidateGitRepo(ctx, destLoc.Path)
}

func inferRepoNameFromURL(u string) string {
	u = strings.TrimSuffix(strings.TrimSpace(u), "/")
	u = strings.TrimSuffix(u, ".git")
	if idx := strings.LastIndexAny(u, "/:"); idx >= 0 && idx+1 < len(u) {
		return u[idx+1:]
	}
	return "repo"
}

// GetConflictFile reads a conflicted file and parses <<< === >>> conflict blocks.
func GetConflictFile(ctx context.Context, loc RepoLocation, relPath string) (ConflictFileContent, error) {
	res := ConflictFileContent{Path: relPath, Blocks: []ConflictBlock{}}
	rawBytes, _, err := readRepoFileBytes(ctx, loc, relPath, 2*1024*1024)
	if err != nil {
		return res, err
	}
	text := strings.ReplaceAll(string(rawBytes), "\r\n", "\n")
	res.RawContent = text

	lines := strings.Split(text, "\n")
	state := 0 // 0=normal, 1=ours, 2=theirs
	var cur ConflictBlock
	blockIdx := 0

	for i, line := range lines {
		switch {
		case strings.HasPrefix(line, "<<<<<<<"):
			state = 1
			cur = ConflictBlock{
				Index:       blockIdx,
				StartLine:   i + 1,
				OursLabel:   strings.TrimSpace(strings.TrimPrefix(line, "<<<<<<<")),
				OursLines:   []string{},
				TheirsLines: []string{},
			}
		case state == 1 && strings.HasPrefix(line, "======="):
			state = 2
		case state == 2 && strings.HasPrefix(line, ">>>>>>>"):
			cur.EndLine = i + 1
			cur.TheirsLabel = strings.TrimSpace(strings.TrimPrefix(line, ">>>>>>>"))
			res.Blocks = append(res.Blocks, cur)
			blockIdx++
			state = 0
		case state == 1:
			cur.OursLines = append(cur.OursLines, line)
		case state == 2:
			cur.TheirsLines = append(cur.TheirsLines, line)
		}
	}
	res.HasConflicts = len(res.Blocks) > 0
	return res, nil
}

// WriteRepoFile writes resolved text back to a file in the repository.
func WriteRepoFile(ctx context.Context, loc RepoLocation, relPath string, content string) error {
	if loc.IsWSL {
		target := path.Join(loc.LinuxPath, relPath)
		cmd := exec.CommandContext(ctx, "wsl.exe", "-d", loc.Distro, "-e", "tee", target)
		hideWindow(cmd)
		cmd.Stdin = strings.NewReader(content)
		if out, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("failed to write WSL file: %s (%w)", strings.TrimSpace(string(out)), err)
		}
		return nil
	}
	fullPath := filepath.Join(loc.Path, filepath.FromSlash(relPath))
	return os.WriteFile(fullPath, []byte(content), 0o644)
}

// AbortMerge aborts an active merge, rebase, or cherry-pick.
func AbortMerge(ctx context.Context, loc RepoLocation) (OpResult, error) {
	state, _ := detectMergeState(ctx, loc)
	var args []string
	switch state {
	case "rebase":
		args = []string{"rebase", "--abort"}
	case "cherry-pick":
		args = []string{"cherry-pick", "--abort"}
	default:
		args = []string{"merge", "--abort"}
	}
	stdout, stderr, err := RunGit(ctx, loc, args...)
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		return OpResult{Success: false, Message: firstNonEmpty(strings.TrimSpace(stderr), err.Error()), Output: combined}, nil
	}
	return OpResult{Success: true, Message: "Aborted " + firstNonEmpty(state, "merge"), Output: combined}, nil
}
