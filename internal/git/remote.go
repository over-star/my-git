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
	remotes, _ := ListRemotes(ctx, loc)
	if len(remotes) == 0 {
		return OpResult{
			Success:   false,
			Message:   "No remote configured for this repository",
			ErrorCode: "NO_REMOTE",
			Output:    "fatal: No remote repository configured.",
		}, nil
	}
	stdout, stderr, err := RunGitOp(ctx, loc, "fetch", "--all", "--prune")
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		return classifyRemoteError(ctx, loc, "", false, stdout, stderr, err, ""), nil
	}
	return OpResult{Success: true, Message: "Fetch completed", Output: combined}, nil
}

// Pull runs git pull and reports merge conflicts clearly.
func Pull(ctx context.Context, loc RepoLocation) (OpResult, error) {
	stdout, stderr, err := RunGitOp(ctx, loc, "pull")
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		low := strings.ToLower(combined)
		if strings.Contains(low, "conflict") || strings.Contains(low, "automatic merge failed") {
			return OpResult{
				Success:   false,
				Message:   firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()),
				ErrorCode: "CONFLICT",
				Output:    combined,
			}, nil
		}
		fallbackCode := ""
		if strings.Contains(low, "no tracking information") {
			fallbackCode = "NO_UPSTREAM"
		}
		return classifyRemoteError(ctx, loc, "", false, stdout, stderr, err, fallbackCode), nil
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
	return classifyRemoteError(ctx, loc, remoteName, true, stdout, stderr, err, "")
}

func classifyRemoteError(ctx context.Context, loc RepoLocation, remoteName string, isPush bool, stdout, stderr string, err error, fallbackCode string) OpResult {
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	low := strings.ToLower(combined)
	code := fallbackCode

	remotes, _ := ListRemotes(ctx, loc)
	hasMatchingRemote := false
	isHTTP := false
	for _, r := range remotes {
		if remoteName != "" && r.Name != remoteName {
			continue
		}
		hasMatchingRemote = true
		u := r.PushURL
		if !isPush || u == "" {
			u = r.FetchURL
		}
		lu := strings.ToLower(strings.TrimSpace(u))
		if strings.HasPrefix(lu, "http://") || strings.HasPrefix(lu, "https://") {
			isHTTP = true
			break
		}
	}

	if isPush && isHTTP {
		code = "HTTPS_REMOTE"
	} else if len(remotes) == 0 ||
		strings.Contains(low, "no configured push destination") ||
		strings.Contains(low, "no such remote") ||
		(!hasMatchingRemote && (strings.Contains(low, "does not appear to be a git repository") || strings.Contains(low, "could not read from remote repository"))) {
		code = "NO_REMOTE"
	} else if strings.Contains(low, "does not appear to be a git repository") ||
		strings.Contains(low, "could not read from remote repository") ||
		strings.Contains(low, "correct access rights") ||
		strings.Contains(low, "permission denied") ||
		strings.Contains(low, "repository not found") ||
		strings.Contains(low, "host key verification failed") {
		code = "REMOTE_ACCESS_ERROR"
	}

	return OpResult{
		Success:   false,
		Message:   firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()),
		ErrorCode: code,
		Output:    combined,
	}
}

// SetBranchUpstream fetches the target remote and sets upstream tracking for localBranch (or current HEAD).
func SetBranchUpstream(ctx context.Context, loc RepoLocation, localBranch, remoteName, remoteBranch string) (OpResult, error) {
	remoteName = strings.TrimSpace(remoteName)
	if remoteName == "" {
		remoteName = resolveDefaultRemote(ctx, loc, "")
	}
	remoteBranch = strings.TrimSpace(remoteBranch)
	remoteBranch = strings.TrimPrefix(remoteBranch, remoteName+"/")
	if remoteBranch == "" {
		return OpResult{Success: false, Message: "Remote branch name is required"}, nil
	}

	localBranch = strings.TrimSpace(localBranch)
	if localBranch == "" {
		bOut, _, bErr := RunGit(ctx, loc, "rev-parse", "--abbrev-ref", "HEAD")
		cur := strings.TrimSpace(bOut)
		if bErr != nil || cur == "" || cur == "HEAD" {
			return OpResult{Success: false, Message: "Cannot set upstream on detached HEAD"}, nil
		}
		localBranch = cur
	}

	// Fetch first so refs/remotes/<remote>/<branch> exists locally before --set-upstream-to.
	fOut, fErrText, fErr := RunGitOp(ctx, loc, "fetch", remoteName)
	if fErr != nil {
		return classifyRemoteError(ctx, loc, remoteName, false, fOut, fErrText, fErr, ""), nil
	}

	upstreamRef := remoteName + "/" + remoteBranch
	stdout, stderr, err := RunGitOp(ctx, loc, "branch", "--set-upstream-to="+upstreamRef, localBranch)
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
		Message: fmt.Sprintf("Set upstream of %s to %s", localBranch, upstreamRef),
		Output:  combined,
	}, nil
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

	stdout, stderr, err := RunGitOp(ctx, loc, args...)
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
		stdout, stderr, err = RunGitOp(ctx, loc, "remote", "add", name, newURL)
	} else {
		stdout, stderr, err = RunGitOp(ctx, loc, "remote", "set-url", name, newURL)
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
	var cloneArgs []string

	if parentLoc.IsWSL {
		targetLinux := path.Join(parentLoc.LinuxPath, folderName)
		destLoc = ParseRepoLocation(fmt.Sprintf("wsl://%s%s", parentLoc.Distro, targetLinux))
		// Ensure parent dir exists
		mk := exec.CommandContext(ctx, "wsl.exe", "-d", parentLoc.Distro, "-e", "mkdir", "-p", parentLoc.LinuxPath)
		hideWindow(mk)
		_ = mk.Run()

		sshCmd := resolveDefaultSSHCommand(ctx, parentLoc, true)
		cloneArgs = []string{"clone", "--progress", repoURL, targetLinux}
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
		cloneArgs = []string{"clone", "--progress", repoURL, targetWin}
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
	obs, cmdID, cmdStr, startedAt := emitCommandStart(ctx, destLoc.Path, cloneArgs)
	if err := cmd.Start(); err != nil {
		emitCommandEnd(obs, cmdID, destLoc.Path, cmdStr, startedAt, "", err.Error(), err)
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
		emitCommandEnd(obs, cmdID, destLoc.Path, cmdStr, startedAt, "", errMsg, err)
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
	emitCommandEnd(obs, cmdID, destLoc.Path, cmdStr, startedAt, "", "", nil)

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

// GetConflictFile reads a conflicted file and parses <<< === >>> (and optional ||||||| base) conflict blocks.
func GetConflictFile(ctx context.Context, loc RepoLocation, relPath string) (ConflictFileContent, error) {
	res := ConflictFileContent{Path: relPath, Blocks: []ConflictBlock{}}
	rawBytes, _, err := readRepoFileBytes(ctx, loc, relPath, 2*1024*1024)
	if err != nil {
		return res, err
	}
	text := strings.ReplaceAll(string(rawBytes), "\r\n", "\n")
	res.RawContent = text

	lines := strings.Split(text, "\n")
	state := 0 // 0=normal, 1=ours, 2=theirs, 3=base (diff3)
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
				BaseLines:   []string{},
				TheirsLines: []string{},
			}
		case state == 1 && strings.HasPrefix(line, "|||||||"):
			state = 3
			cur.BaseLabel = strings.TrimSpace(strings.TrimPrefix(line, "|||||||"))
		case (state == 1 || state == 3) && strings.HasPrefix(line, "======="):
			state = 2
		case state == 2 && strings.HasPrefix(line, ">>>>>>>"):
			cur.EndLine = i + 1
			cur.TheirsLabel = strings.TrimSpace(strings.TrimPrefix(line, ">>>>>>>"))
			res.Blocks = append(res.Blocks, cur)
			blockIdx++
			state = 0
		case state == 1:
			cur.OursLines = append(cur.OursLines, line)
		case state == 3:
			cur.BaseLines = append(cur.BaseLines, line)
		case state == 2:
			cur.TheirsLines = append(cur.TheirsLines, line)
		}
	}
	res.HasConflicts = len(res.Blocks) > 0
	return res, nil
}

// ResolveConflictSide resolves a conflicted file by taking either "ours" or "theirs" and staging the result.
// Handles delete/modify conflicts where checking out one side fails because the file was deleted on that side.
func ResolveConflictSide(ctx context.Context, loc RepoLocation, relPath, side string) (OpResult, error) {
	side = strings.ToLower(strings.TrimSpace(side))
	if side != "ours" && side != "theirs" {
		return OpResult{Success: false, Message: "Invalid conflict side; must be 'ours' or 'theirs'"}, nil
	}
	checkoutArgs := []string{"checkout", "--" + side, "--", relPath}
	obs, cmdID, cmdStr, startedAt := emitCommandStart(ctx, loc.Path, checkoutArgs)
	stdout, stderr, err := RunGit(ctx, loc, checkoutArgs...)
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		low := strings.ToLower(combined)
		if strings.Contains(low, "does not have") {
			rmOut, rmErrText, rmErr := RunGitOp(ctx, loc, "rm", "--", relPath)
			rmCombined := strings.TrimSpace(rmOut + "\n" + rmErrText)
			if rmErr != nil {
				return OpResult{
					Success: false,
					Message: firstNonEmpty(strings.TrimSpace(rmErrText), strings.TrimSpace(rmOut), rmErr.Error()),
					Output:  rmCombined,
				}, nil
			}
			return OpResult{
				Success: true,
				Message: fmt.Sprintf("Resolved %s by removing file (%s side)", relPath, side),
				Output:  rmCombined,
			}, nil
		}
		emitCommandEnd(obs, cmdID, loc.Path, cmdStr, startedAt, stdout, stderr, err)
		return OpResult{
			Success: false,
			Message: firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()),
			Output:  combined,
		}, nil
	}
	emitCommandEnd(obs, cmdID, loc.Path, cmdStr, startedAt, stdout, stderr, nil)
	if stErr := StageFile(ctx, loc, relPath); stErr != nil {
		return OpResult{Success: false, Message: stErr.Error(), Output: combined}, nil
	}
	return OpResult{
		Success: true,
		Message: fmt.Sprintf("Resolved %s using %s version", relPath, side),
		Output:  combined,
	}, nil
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
	stdout, stderr, err := RunGitOp(ctx, loc, args...)
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		return OpResult{Success: false, Message: firstNonEmpty(strings.TrimSpace(stderr), err.Error()), Output: combined}, nil
	}
	return OpResult{Success: true, Message: "Aborted " + firstNonEmpty(state, "merge"), Output: combined}, nil
}
