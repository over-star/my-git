package git

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var aheadRe = regexp.MustCompile(`ahead (\d+)`)
var behindRe = regexp.MustCompile(`behind (\d+)`)

// ListBranches returns all local and remote branches with tracking info.
func ListBranches(ctx context.Context, loc RepoLocation) ([]BranchInfo, error) {
	format := "%(refname)%1f%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(upstream:track,nobracket)%1f%(objectname:short)%1f%(subject)"
	out, stderr, err := RunGit(ctx, loc, "for-each-ref", "--sort=-HEAD", "--sort=refname", "--format="+format, "refs/heads", "refs/remotes")
	if err != nil {
		return nil, fmt.Errorf("failed to list branches: %s (%w)", strings.TrimSpace(stderr), err)
	}

	// Check if any remote exists so we can count unpushed commits for branches without upstream
	hasRemotes := false
	if rOut, _, rerr := RunGit(ctx, loc, "remote"); rerr == nil && strings.TrimSpace(rOut) != "" {
		hasRemotes = true
	}

	var branches []BranchInfo
	lines := strings.Split(strings.ReplaceAll(out, "\r\n", "\n"), "\n")
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		f := strings.SplitN(line, "\x1f", 7)
		if len(f) < 7 {
			continue
		}
		fullName := f[0]
		shortName := f[1]
		isCurrent := f[2] == "*"
		upstream := f[3]
		track := f[4]
		lastSHA := f[5]
		lastMsg := f[6]

		isRemote := strings.HasPrefix(fullName, "refs/remotes/")
		if isRemote && strings.HasSuffix(shortName, "/HEAD") {
			continue
		}
		remoteName := ""
		if isRemote {
			parts := strings.SplitN(shortName, "/", 2)
			remoteName = parts[0]
		}

		ahead, behind := 0, 0
		if m := aheadRe.FindStringSubmatch(track); len(m) == 2 {
			ahead, _ = strconv.Atoi(m[1])
		}
		if m := behindRe.FindStringSubmatch(track); len(m) == 2 {
			behind, _ = strconv.Atoi(m[1])
		}
		if !isRemote && upstream == "" && hasRemotes {
			if cntOut, _, cerr := RunGit(ctx, loc, "rev-list", "--count", shortName, "--not", "--remotes"); cerr == nil {
				ahead, _ = strconv.Atoi(strings.TrimSpace(cntOut))
			}
		}

		branches = append(branches, BranchInfo{
			Name:       shortName,
			FullName:   fullName,
			IsCurrent:  isCurrent,
			IsRemote:   isRemote,
			RemoteName: remoteName,
			Upstream:   upstream,
			Ahead:      ahead,
			Behind:     behind,
			LastSHA:    lastSHA,
			LastMsg:    lastMsg,
		})
	}
	return branches, nil
}

func classifyCheckoutResult(targetLabel, stdout, stderr string, err error) OpResult {
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		low := strings.ToLower(combined)
		code := ""
		if strings.Contains(low, "would be overwritten") ||
			strings.Contains(low, "commit your changes or stash them") ||
			strings.Contains(low, "uncommitted changes") {
			code = "DIRTY_WORKTREE"
		}
		return OpResult{
			Success:   false,
			Message:   firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()),
			ErrorCode: code,
			Output:    combined,
		}
	}
	return OpResult{Success: true, Message: "Switched to " + targetLabel, Output: combined}
}

// CheckoutBranch switches to an existing branch (local or creates tracking branch for remote).
func CheckoutBranch(ctx context.Context, loc RepoLocation, branchName string, isRemote bool) (OpResult, error) {
	var args []string
	if isRemote {
		// Strip remote prefix e.g. origin/feat -> checkout -t origin/feat or local branch if exists
		parts := strings.SplitN(branchName, "/", 2)
		localName := branchName
		if len(parts) == 2 {
			localName = parts[1]
		}
		// Check if local branch already exists
		if _, _, err := RunGit(ctx, loc, "show-ref", "--verify", "--quiet", "refs/heads/"+localName); err == nil {
			args = []string{"checkout", localName}
		} else {
			args = []string{"checkout", "-b", localName, "--track", branchName}
		}
	} else {
		args = []string{"checkout", branchName}
	}

	stdout, stderr, err := RunGit(ctx, loc, args...)
	return classifyCheckoutResult(branchName, stdout, stderr, err), nil
}

// CreateBranch creates a new branch from startPoint (defaults to HEAD) and optionally checks it out.
func CreateBranch(ctx context.Context, loc RepoLocation, name, startPoint string, checkout bool) (OpResult, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return OpResult{Success: false, Message: "Branch name is required"}, nil
	}
	var args []string
	if checkout {
		args = []string{"checkout", "-b", name}
	} else {
		args = []string{"branch", name}
	}
	if strings.TrimSpace(startPoint) != "" {
		args = append(args, strings.TrimSpace(startPoint))
	}

	stdout, stderr, err := RunGit(ctx, loc, args...)
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		return OpResult{
			Success: false,
			Message: firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()),
			Output:  combined,
		}, nil
	}
	return OpResult{Success: true, Message: "Created branch " + name, Output: combined}, nil
}

// MergeBranch merges the specified branch into the current branch.
func MergeBranch(ctx context.Context, loc RepoLocation, branchName string) (OpResult, error) {
	stdout, stderr, err := RunGit(ctx, loc, "merge", branchName)
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		low := strings.ToLower(combined)
		code := ""
		if strings.Contains(low, "conflict") || strings.Contains(low, "automatic merge failed") {
			code = "CONFLICT"
		} else if strings.Contains(low, "would be overwritten") || strings.Contains(low, "commit your changes or stash them") {
			code = "DIRTY_WORKTREE"
		}
		return OpResult{
			Success:   false,
			Message:   firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()),
			ErrorCode: code,
			Output:    combined,
		}, nil
	}
	return OpResult{Success: true, Message: "Merged " + branchName, Output: combined}, nil
}

// DeleteBranch deletes a local branch (-d or -D).
func DeleteBranch(ctx context.Context, loc RepoLocation, name string, force bool) (OpResult, error) {
	flag := "-d"
	if force {
		flag = "-D"
	}
	stdout, stderr, err := RunGit(ctx, loc, "branch", flag, name)
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		return OpResult{
			Success: false,
			Message: firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()),
			Output:  combined,
		}, nil
	}
	return OpResult{Success: true, Message: "Deleted branch " + name, Output: combined}, nil
}

// RenameBranch renames a local branch.
func RenameBranch(ctx context.Context, loc RepoLocation, oldName, newName string) (OpResult, error) {
	oldName = strings.TrimSpace(oldName)
	newName = strings.TrimSpace(newName)
	if oldName == "" || newName == "" {
		return OpResult{Success: false, Message: "Both old and new branch names are required"}, nil
	}
	stdout, stderr, err := RunGit(ctx, loc, "branch", "-m", oldName, newName)
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		return OpResult{
			Success: false,
			Message: firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()),
			Output:  combined,
		}, nil
	}
	return OpResult{Success: true, Message: fmt.Sprintf("Renamed branch %s to %s", oldName, newName), Output: combined}, nil
}

// DeleteRemoteBranch deletes a branch on the remote repository via git push <remote> --delete <branch>.
func DeleteRemoteBranch(ctx context.Context, loc RepoLocation, remoteBranch string) (OpResult, error) {
	parts := strings.SplitN(strings.TrimSpace(remoteBranch), "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return OpResult{Success: false, Message: "Invalid remote branch name: " + remoteBranch}, nil
	}
	remoteName, branchName := parts[0], parts[1]
	stdout, stderr, err := RunGit(ctx, loc, "push", remoteName, "--delete", branchName)
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		return OpResult{
			Success: false,
			Message: firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()),
			Output:  combined,
		}, nil
	}
	return OpResult{Success: true, Message: "Deleted remote branch " + remoteBranch, Output: combined}, nil
}

// ListTags returns repository tags sorted newest first.
func ListTags(ctx context.Context, loc RepoLocation) ([]TagInfo, error) {
	out, stderr, err := RunGit(ctx, loc, "tag", "-l", "--sort=-creatordate", "--format=%(refname:short)%1f%(objectname:short)%1f%(contents:subject)")
	if err != nil {
		return nil, fmt.Errorf("failed to list tags: %s (%w)", strings.TrimSpace(stderr), err)
	}
	var tags []TagInfo
	for _, line := range strings.Split(strings.ReplaceAll(out, "\r\n", "\n"), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		f := strings.SplitN(line, "\x1f", 3)
		if len(f) < 2 {
			continue
		}
		msg := ""
		if len(f) > 2 {
			msg = f[2]
		}
		tags = append(tags, TagInfo{Name: f[0], Hash: f[1], Message: msg})
	}
	return tags, nil
}

// CreateTag creates a tag at target (default HEAD).
func CreateTag(ctx context.Context, loc RepoLocation, name, target, message string) (OpResult, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return OpResult{Success: false, Message: "Tag name is required"}, nil
	}
	args := []string{"tag"}
	if strings.TrimSpace(message) != "" {
		args = append(args, "-a", name, "-m", strings.TrimSpace(message))
	} else {
		args = append(args, name)
	}
	if strings.TrimSpace(target) != "" {
		args = append(args, strings.TrimSpace(target))
	}
	stdout, stderr, err := RunGit(ctx, loc, args...)
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		return OpResult{Success: false, Message: firstNonEmpty(strings.TrimSpace(stderr), err.Error()), Output: combined}, nil
	}
	return OpResult{Success: true, Message: "Created tag " + name, Output: combined}, nil
}

// CheckoutTag checks out a tag in detached HEAD state.
func CheckoutTag(ctx context.Context, loc RepoLocation, tagName string) (OpResult, error) {
	tagName = strings.TrimSpace(tagName)
	if tagName == "" {
		return OpResult{Success: false, Message: "Tag name is required"}, nil
	}
	stdout, stderr, err := RunGit(ctx, loc, "checkout", "refs/tags/"+tagName)
	return classifyCheckoutResult("tag "+tagName+" (detached HEAD)", stdout, stderr, err), nil
}

// DeleteTag deletes a local Git tag.
func DeleteTag(ctx context.Context, loc RepoLocation, name string) (OpResult, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return OpResult{Success: false, Message: "Tag name is required"}, nil
	}
	stdout, stderr, err := RunGit(ctx, loc, "tag", "-d", name)
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		return OpResult{
			Success: false,
			Message: firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()),
			Output:  combined,
		}, nil
	}
	return OpResult{Success: true, Message: "Deleted tag " + name, Output: combined}, nil
}

// PushTag pushes a local tag to the specified remote (defaults to origin or first remote).
func PushTag(ctx context.Context, loc RepoLocation, remoteName, tagName string) (OpResult, error) {
	tagName = strings.TrimSpace(tagName)
	if tagName == "" {
		return OpResult{Success: false, Message: "Tag name is required"}, nil
	}
	remote := resolveDefaultRemote(ctx, loc, remoteName)
	stdout, stderr, err := RunGit(ctx, loc, "push", remote, "refs/tags/"+tagName)
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		return classifyPushError(ctx, loc, remote, stdout, stderr, err), nil
	}
	return OpResult{
		Success: true,
		Message: fmt.Sprintf("Pushed tag %s to %s", tagName, remote),
		Output:  combined,
	}, nil
}

// DeleteRemoteTag deletes a tag on the specified remote via git push <remote> --delete refs/tags/<tag>.
func DeleteRemoteTag(ctx context.Context, loc RepoLocation, remoteName, tagName string) (OpResult, error) {
	tagName = strings.TrimSpace(tagName)
	if tagName == "" {
		return OpResult{Success: false, Message: "Tag name is required"}, nil
	}
	remote := resolveDefaultRemote(ctx, loc, remoteName)
	stdout, stderr, err := RunGit(ctx, loc, "push", remote, "--delete", "refs/tags/"+tagName)
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		return classifyPushError(ctx, loc, remote, stdout, stderr, err), nil
	}
	return OpResult{
		Success: true,
		Message: fmt.Sprintf("Deleted tag %s on %s", tagName, remote),
		Output:  combined,
	}, nil
}

// ListStashes returns all saved stashes.
func ListStashes(ctx context.Context, loc RepoLocation) ([]StashItem, error) {
	out, stderr, err := RunGit(ctx, loc, "stash", "list", "--format=%gd%x1f%cr%x1f%gs")
	if err != nil {
		return nil, fmt.Errorf("failed to list stashes: %s (%w)", strings.TrimSpace(stderr), err)
	}
	var stashes []StashItem
	idx := 0
	for _, line := range strings.Split(strings.ReplaceAll(out, "\r\n", "\n"), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		f := strings.SplitN(line, "\x1f", 3)
		if len(f) < 3 {
			continue
		}
		ref := f[0]
		rel := f[1]
		msg := f[2]
		branch := ""
		if strings.HasPrefix(msg, "WIP on ") {
			if colon := strings.Index(msg, ":"); colon > 7 {
				branch = msg[7:colon]
			}
		} else if strings.HasPrefix(msg, "On ") {
			if colon := strings.Index(msg, ":"); colon > 3 {
				branch = msg[3:colon]
			}
		}
		stashes = append(stashes, StashItem{
			Index:        idx,
			Ref:          ref,
			Branch:       branch,
			Message:      msg,
			RelativeTime: rel,
		})
		idx++
	}
	return stashes, nil
}

// StashPush saves working tree changes into a new stash.
func StashPush(ctx context.Context, loc RepoLocation, message string, includeUntracked bool) (OpResult, error) {
	args := []string{"stash", "push"}
	if includeUntracked {
		args = append(args, "-u")
	}
	if strings.TrimSpace(message) != "" {
		args = append(args, "-m", strings.TrimSpace(message))
	}
	stdout, stderr, err := RunGit(ctx, loc, args...)
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		return OpResult{Success: false, Message: firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()), Output: combined}, nil
	}
	return OpResult{Success: true, Message: "Changes stashed", Output: combined}, nil
}

// StashApply applies a stash without removing it.
func StashApply(ctx context.Context, loc RepoLocation, ref string) (OpResult, error) {
	if ref == "" {
		ref = "stash@{0}"
	}
	stdout, stderr, err := RunGit(ctx, loc, "stash", "apply", ref)
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		code := ""
		if strings.Contains(strings.ToLower(combined), "conflict") {
			code = "CONFLICT"
		}
		return OpResult{Success: false, Message: firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()), ErrorCode: code, Output: combined}, nil
	}
	return OpResult{Success: true, Message: "Applied " + ref, Output: combined}, nil
}

// StashPop applies a stash and removes it from the stash list.
func StashPop(ctx context.Context, loc RepoLocation, ref string) (OpResult, error) {
	if ref == "" {
		ref = "stash@{0}"
	}
	stdout, stderr, err := RunGit(ctx, loc, "stash", "pop", ref)
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		code := ""
		if strings.Contains(strings.ToLower(combined), "conflict") {
			code = "CONFLICT"
		}
		return OpResult{Success: false, Message: firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()), ErrorCode: code, Output: combined}, nil
	}
	return OpResult{Success: true, Message: "Popped " + ref, Output: combined}, nil
}

// StashDrop deletes a stash entry.
func StashDrop(ctx context.Context, loc RepoLocation, ref string) (OpResult, error) {
	if ref == "" {
		ref = "stash@{0}"
	}
	stdout, stderr, err := RunGit(ctx, loc, "stash", "drop", ref)
	combined := strings.TrimSpace(stdout + "\n" + stderr)
	if err != nil {
		return OpResult{Success: false, Message: firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()), Output: combined}, nil
	}
	return OpResult{Success: true, Message: "Dropped " + ref, Output: combined}, nil
}
