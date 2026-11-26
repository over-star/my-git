package git

import (
	"context"
	"fmt"
	"path"
	"path/filepath"
	"strings"
)

// ListWorktrees returns all worktrees registered for the repository.
func ListWorktrees(ctx context.Context, loc RepoLocation) ([]WorktreeInfo, error) {
	out, stderr, err := RunGit(ctx, loc, "worktree", "list", "--porcelain")
	if err != nil {
		return nil, fmt.Errorf("failed to list worktrees: %s (%w)", strings.TrimSpace(stderr), err)
	}

	rawBlocks := parseWorktreePorcelain(out)
	items := make([]WorktreeInfo, 0, len(rawBlocks))
	for i, blk := range rawBlocks {
		wtLoc := worktreeGitPathToLocation(loc, blk.rawPath)
		rawDisplay := wtLoc.Path
		if wtLoc.IsWSL {
			rawDisplay = wtLoc.LinuxPath
		}
		headShort := blk.headSHA
		if len(headShort) > 7 {
			headShort = headShort[:7]
		}
		branchShort := ""
		if blk.branchFull != "" {
			branchShort = strings.TrimPrefix(blk.branchFull, "refs/heads/")
		}
		items = append(items, WorktreeInfo{
			Path:        wtLoc.Path,
			RawPath:     rawDisplay,
			Name:        wtLoc.Name,
			HeadSHA:     headShort,
			FullSHA:     blk.headSHA,
			Branch:      branchShort,
			BranchFull:  blk.branchFull,
			IsMain:      i == 0,
			IsCurrent:   sameRepoLocationPath(loc, wtLoc),
			IsBare:      blk.isBare,
			IsDetached:  blk.isDetached,
			IsLocked:    blk.isLocked,
			LockReason:  blk.lockReason,
			IsPrunable:  blk.isPrunable,
			PruneReason: blk.pruneReason,
		})
	}
	return items, nil
}

type rawWorktreeBlock struct {
	rawPath     string
	headSHA     string
	branchFull  string
	isBare      bool
	isDetached  bool
	isLocked    bool
	lockReason  string
	isPrunable  bool
	pruneReason string
}

func parseWorktreePorcelain(out string) []rawWorktreeBlock {
	normalized := strings.ReplaceAll(out, "\r\n", "\n")
	lines := strings.Split(normalized, "\n")

	var blocks []rawWorktreeBlock
	var cur *rawWorktreeBlock
	flush := func() {
		if cur != nil && cur.rawPath != "" {
			blocks = append(blocks, *cur)
		}
		cur = nil
	}

	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			flush()
			continue
		}
		if strings.HasPrefix(line, "worktree ") {
			flush()
			cur = &rawWorktreeBlock{
				rawPath: strings.TrimSpace(strings.TrimPrefix(line, "worktree ")),
			}
			continue
		}
		if cur == nil {
			continue
		}
		switch {
		case strings.HasPrefix(line, "HEAD "):
			cur.headSHA = strings.TrimSpace(strings.TrimPrefix(line, "HEAD "))
		case strings.HasPrefix(line, "branch "):
			cur.branchFull = strings.TrimSpace(strings.TrimPrefix(line, "branch "))
		case line == "bare":
			cur.isBare = true
		case line == "detached":
			cur.isDetached = true
		case line == "locked":
			cur.isLocked = true
		case strings.HasPrefix(line, "locked "):
			cur.isLocked = true
			cur.lockReason = strings.TrimSpace(strings.TrimPrefix(line, "locked "))
		case line == "prunable":
			cur.isPrunable = true
		case strings.HasPrefix(line, "prunable "):
			cur.isPrunable = true
			cur.pruneReason = strings.TrimSpace(strings.TrimPrefix(line, "prunable "))
		}
	}
	flush()
	return blocks
}

func worktreeGitPathToLocation(hostLoc RepoLocation, gitReportedPath string) RepoLocation {
	p := strings.TrimSpace(gitReportedPath)
	if hostLoc.IsWSL {
		if strings.HasPrefix(strings.ToLower(p), "wsl://") || strings.HasPrefix(p, `\\`) {
			return ParseRepoLocation(p)
		}
		cleanLinux := path.Clean(p)
		return ParseRepoLocation(fmt.Sprintf("wsl://%s%s", hostLoc.Distro, cleanLinux))
	}
	return ParseRepoLocation(filepath.FromSlash(p))
}

func resolveWorktreeCLIPath(loc RepoLocation, targetPath string) (cliPath string, canonical RepoLocation) {
	trimmed := strings.TrimSpace(targetPath)
	if loc.IsWSL {
		if strings.HasPrefix(strings.ToLower(trimmed), "wsl://") || strings.HasPrefix(trimmed, `\\`) {
			parsed := ParseRepoLocation(trimmed)
			return parsed.LinuxPath, parsed
		}
		linuxP := strings.ReplaceAll(trimmed, `\`, "/")
		if !strings.HasPrefix(linuxP, "/") {
			linuxP = path.Join(loc.LinuxPath, linuxP)
		}
		linuxP = path.Clean(linuxP)
		return linuxP, ParseRepoLocation(fmt.Sprintf("wsl://%s%s", loc.Distro, linuxP))
	}

	winP := filepath.FromSlash(trimmed)
	if !filepath.IsAbs(winP) {
		winP = filepath.Join(loc.Path, winP)
	}
	winP = filepath.Clean(winP)
	return winP, ParseRepoLocation(winP)
}

func sameRepoLocationPath(a, b RepoLocation) bool {
	if a.IsWSL != b.IsWSL {
		return false
	}
	if a.IsWSL {
		return strings.EqualFold(a.Distro, b.Distro) && path.Clean(a.LinuxPath) == path.Clean(b.LinuxPath)
	}
	return normalizeLocalPathKey(a.Path) == normalizeLocalPathKey(b.Path)
}

// AddWorktree creates a new linked worktree at targetPath.
// Modes:
//   - detach=true: checks out commit/ref in detached HEAD mode
//   - createBranch=true: creates a new branch `branch` starting at `baseRef` (or HEAD)
//   - otherwise: checks out existing local branch or creates tracking branch from remote branch `branch`
func AddWorktree(ctx context.Context, loc RepoLocation, targetPath, branch, baseRef string, createBranch, detach, force bool) (AddWorktreeResult, error) {
	var out AddWorktreeResult
	trimmedTarget := strings.TrimSpace(targetPath)
	if trimmedTarget == "" {
		out.Result = OpResult{Success: false, Message: "Worktree directory path is required"}
		return out, nil
	}
	cliTarget, canonicalLoc := resolveWorktreeCLIPath(loc, trimmedTarget)
	branch = strings.TrimSpace(branch)
	baseRef = strings.TrimSpace(baseRef)

	args := []string{"worktree", "add"}
	if force {
		args = append(args, "--force")
	}

	switch {
	case detach:
		args = append(args, "--detach", cliTarget)
		ref := firstNonEmpty(baseRef, branch)
		if ref != "" {
			args = append(args, ref)
		}
	case createBranch:
		if branch == "" {
			out.Result = OpResult{Success: false, Message: "New branch name is required"}
			return out, nil
		}
		args = append(args, "-b", branch, cliTarget)
		if baseRef != "" {
			args = append(args, baseRef)
		}
	default:
		if branch == "" {
			out.Result = OpResult{Success: false, Message: "Branch name is required"}
			return out, nil
		}
		// Check if it's a remote branch (e.g. origin/feat) without a matching local branch
		if _, _, rerr := RunGit(ctx, loc, "show-ref", "--verify", "--quiet", "refs/heads/"+branch); rerr == nil {
			args = append(args, cliTarget, branch)
		} else if _, _, remErr := RunGit(ctx, loc, "show-ref", "--verify", "--quiet", "refs/remotes/"+branch); remErr == nil {
			parts := strings.SplitN(branch, "/", 2)
			localName := branch
			if len(parts) == 2 {
				localName = parts[1]
			}
			if _, _, lerr := RunGit(ctx, loc, "show-ref", "--verify", "--quiet", "refs/heads/"+localName); lerr == nil {
				args = append(args, cliTarget, localName)
			} else {
				args = append(args, "--track", "-b", localName, cliTarget, branch)
			}
		} else {
			args = append(args, cliTarget, branch)
		}
	}

	stdout, stderr, err := RunGit(ctx, loc, args...)
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		low := strings.ToLower(combined)
		code := ""
		if strings.Contains(low, "is already used by worktree") || strings.Contains(low, "already checked out at") {
			code = "WORKTREE_IN_USE"
		}
		out.Result = OpResult{
			Success:   false,
			Message:   firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()),
			ErrorCode: code,
			Output:    combined,
		}
		return out, nil
	}

	validated, verr := ValidateGitRepo(ctx, canonicalLoc.Path)
	if verr == nil {
		out.Repo = validated
	} else {
		out.Repo = canonicalLoc
	}
	out.Result = OpResult{
		Success: true,
		Message: "Created worktree at " + canonicalLoc.Name,
		Output:  combined,
	}
	return out, nil
}

// RemoveWorktree removes a linked worktree from disk and unregisters it.
func RemoveWorktree(ctx context.Context, loc RepoLocation, worktreePath string, force bool) (OpResult, error) {
	cliPath, _ := resolveWorktreeCLIPath(loc, worktreePath)
	if cliPath == "" {
		return OpResult{Success: false, Message: "Worktree path is required"}, nil
	}
	args := []string{"worktree", "remove"}
	if force {
		args = append(args, "--force")
	}
	args = append(args, cliPath)

	stdout, stderr, err := RunGit(ctx, loc, args...)
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		low := strings.ToLower(combined)
		code := ""
		if strings.Contains(low, "locked working tree") || strings.Contains(low, "is locked") {
			code = "LOCKED_WORKTREE"
		} else if strings.Contains(low, "contains modified or untracked files") || strings.Contains(low, "use --force") {
			code = "DIRTY_WORKTREE"
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
		Message: "Removed worktree " + path.Base(strings.ReplaceAll(cliPath, `\`, "/")),
		Output:  combined,
	}, nil
}

// LockWorktree locks a linked worktree to prevent pruning or accidental removal.
func LockWorktree(ctx context.Context, loc RepoLocation, worktreePath, reason string) (OpResult, error) {
	cliPath, _ := resolveWorktreeCLIPath(loc, worktreePath)
	if cliPath == "" {
		return OpResult{Success: false, Message: "Worktree path is required"}, nil
	}
	args := []string{"worktree", "lock"}
	reason = strings.TrimSpace(reason)
	if reason != "" {
		args = append(args, "--reason", reason)
	}
	args = append(args, cliPath)

	stdout, stderr, err := RunGit(ctx, loc, args...)
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		return OpResult{
			Success: false,
			Message: firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()),
			Output:  combined,
		}, nil
	}
	return OpResult{Success: true, Message: "Locked worktree", Output: combined}, nil
}

// UnlockWorktree unlocks a locked linked worktree.
func UnlockWorktree(ctx context.Context, loc RepoLocation, worktreePath string) (OpResult, error) {
	cliPath, _ := resolveWorktreeCLIPath(loc, worktreePath)
	if cliPath == "" {
		return OpResult{Success: false, Message: "Worktree path is required"}, nil
	}
	stdout, stderr, err := RunGit(ctx, loc, "worktree", "unlock", cliPath)
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		return OpResult{
			Success: false,
			Message: firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()),
			Output:  combined,
		}, nil
	}
	return OpResult{Success: true, Message: "Unlocked worktree", Output: combined}, nil
}

// PruneWorktrees removes stale administrative files for deleted worktree directories.
func PruneWorktrees(ctx context.Context, loc RepoLocation) (OpResult, error) {
	stdout, stderr, err := RunGit(ctx, loc, "worktree", "prune", "-v")
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		return OpResult{
			Success: false,
			Message: firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()),
			Output:  combined,
		}, nil
	}
	msg := "Pruned stale worktrees"
	if combined == "" {
		msg = "No stale worktrees to prune"
	}
	return OpResult{Success: true, Message: msg, Output: combined}, nil
}
