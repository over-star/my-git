package git

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseWorktreePorcelain(t *testing.T) {
	raw := strings.Join([]string{
		"worktree D:/code/repo",
		"HEAD 1111111111111111111111111111111111111111",
		"branch refs/heads/main",
		"",
		"worktree D:/code/repo-feat",
		"HEAD 2222222222222222222222222222222222222222",
		"branch refs/heads/feat/ui",
		"locked on external drive",
		"",
		"worktree D:/code/repo-detached",
		"HEAD 3333333333333333333333333333333333333333",
		"detached",
		"prunable gitdir file points to non-existent location",
		"",
	}, "\n")

	blocks := parseWorktreePorcelain(raw)
	if len(blocks) != 3 {
		t.Fatalf("got %d blocks, want 3", len(blocks))
	}
	if blocks[0].rawPath != "D:/code/repo" || blocks[0].branchFull != "refs/heads/main" {
		t.Fatalf("unexpected block 0: %+v", blocks[0])
	}
	if !blocks[1].isLocked || blocks[1].lockReason != "on external drive" {
		t.Fatalf("unexpected block 1 lock: %+v", blocks[1])
	}
	if !blocks[2].isDetached || !blocks[2].isPrunable || blocks[2].pruneReason == "" {
		t.Fatalf("unexpected block 2 state: %+v", blocks[2])
	}
}

func TestWorktreeLifecycle(t *testing.T) {
	ctx := context.Background()
	parent := t.TempDir()
	mainDir := filepath.Join(parent, "main-repo")
	wtDir := filepath.Join(parent, "wt-feat")
	wtDetachedDir := filepath.Join(parent, "wt-detached")

	loc, err := InitRepo(ctx, mainDir)
	if err != nil {
		t.Fatalf("InitRepo failed: %v", err)
	}
	if _, stderr, err := RunGit(ctx, loc, "config", "user.name", "Test User"); err != nil {
		t.Fatalf("git config user.name failed: %s (%v)", stderr, err)
	}
	if _, stderr, err := RunGit(ctx, loc, "config", "user.email", "test@example.com"); err != nil {
		t.Fatalf("git config user.email failed: %s (%v)", stderr, err)
	}
	if err := os.WriteFile(filepath.Join(mainDir, "a.txt"), []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := StageAll(ctx, loc); err != nil {
		t.Fatal(err)
	}
	if res, err := Commit(ctx, loc, "init", "", false); err != nil || !res.Success {
		t.Fatalf("Commit failed: %+v %v", res, err)
	}

	// Main repo should not report IsWorktree
	mainLoc, err := ValidateGitRepo(ctx, mainDir)
	if err != nil {
		t.Fatalf("ValidateGitRepo main failed: %v", err)
	}
	if mainLoc.IsWorktree {
		t.Fatalf("expected main repo IsWorktree=false, got true")
	}
	if mainLoc.CommonDir == "" {
		t.Fatalf("expected non-empty CommonDir")
	}

	// Create linked worktree with new branch
	addRes, err := AddWorktree(ctx, mainLoc, wtDir, "feat/wt", "", true, false, false)
	if err != nil || !addRes.Result.Success {
		t.Fatalf("AddWorktree failed: %+v %v", addRes, err)
	}
	if !addRes.Repo.IsWorktree {
		t.Fatalf("expected linked worktree IsWorktree=true")
	}
	if addRes.Repo.CommonDir != mainLoc.CommonDir {
		t.Fatalf("CommonDir mismatch: wt=%q main=%q", addRes.Repo.CommonDir, mainLoc.CommonDir)
	}

	// Checkout of branch already checked out in wtDir should yield WORKTREE_IN_USE
	ckRes, err := CheckoutBranch(ctx, mainLoc, "feat/wt", false)
	if err != nil {
		t.Fatalf("CheckoutBranch error: %v", err)
	}
	if ckRes.Success || ckRes.ErrorCode != "WORKTREE_IN_USE" {
		t.Fatalf("expected WORKTREE_IN_USE, got: %+v", ckRes)
	}

	// ListWorktrees from both main and linked worktree
	list, err := ListWorktrees(ctx, mainLoc)
	if err != nil || len(list) != 2 {
		t.Fatalf("ListWorktrees failed: len=%d err=%v", len(list), err)
	}
	if !list[0].IsMain || !list[0].IsCurrent {
		t.Fatalf("unexpected main entry: %+v", list[0])
	}
	if list[1].IsMain || list[1].IsCurrent || list[1].Branch != "feat/wt" {
		t.Fatalf("unexpected linked entry: %+v", list[1])
	}

	// Lock & Unlock
	lockRes, err := LockWorktree(ctx, mainLoc, wtDir, "testing lock")
	if err != nil || !lockRes.Success {
		t.Fatalf("LockWorktree failed: %+v %v", lockRes, err)
	}
	list, _ = ListWorktrees(ctx, addRes.Repo)
	if !list[1].IsLocked || list[1].LockReason != "testing lock" || !list[1].IsCurrent {
		t.Fatalf("expected locked and current on wt entry: %+v", list[1])
	}

	// Removing locked worktree should report LOCKED_WORKTREE
	remLocked, err := RemoveWorktree(ctx, mainLoc, wtDir, false)
	if err != nil || remLocked.Success || remLocked.ErrorCode != "LOCKED_WORKTREE" {
		t.Fatalf("expected LOCKED_WORKTREE, got: %+v %v", remLocked, err)
	}

	unlockRes, err := UnlockWorktree(ctx, mainLoc, wtDir)
	if err != nil || !unlockRes.Success {
		t.Fatalf("UnlockWorktree failed: %+v %v", unlockRes, err)
	}

	// Remove cleanly
	remRes, err := RemoveWorktree(ctx, mainLoc, wtDir, false)
	if err != nil || !remRes.Success {
		t.Fatalf("RemoveWorktree failed: %+v %v", remRes, err)
	}

	// Create detached worktree, delete dir manually, then prune
	detRes, err := AddWorktree(ctx, mainLoc, wtDetachedDir, "", "HEAD", false, true, false)
	if err != nil || !detRes.Result.Success {
		t.Fatalf("AddWorktree detached failed: %+v %v", detRes, err)
	}
	if err := os.RemoveAll(wtDetachedDir); err != nil {
		t.Fatal(err)
	}
	list, _ = ListWorktrees(ctx, mainLoc)
	if len(list) != 2 || !list[1].IsPrunable {
		t.Fatalf("expected prunable worktree, got: %+v", list)
	}
	pruneRes, err := PruneWorktrees(ctx, mainLoc)
	if err != nil || !pruneRes.Success {
		t.Fatalf("PruneWorktrees failed: %+v %v", pruneRes, err)
	}
	list, _ = ListWorktrees(ctx, mainLoc)
	if len(list) != 1 {
		t.Fatalf("expected 1 worktree after prune, got %d", len(list))
	}
}
