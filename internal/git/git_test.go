package git

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestParseRepoLocation(t *testing.T) {
	tests := []struct {
		in        string
		isWSL     bool
		distro    string
		linuxPath string
		name      string
	}{
		{`D:\code\go\mygit`, false, "", "", "mygit"},
		{`\\wsl$\Ubuntu-24.04\home\rufo\project`, true, "Ubuntu-24.04", "/home/rufo/project", "project"},
		{`\\wsl.localhost\Ubuntu-24.04\home\rufo\app`, true, "Ubuntu-24.04", "/home/rufo/app", "app"},
		{`wsl://Debian/srv/repo`, true, "Debian", "/srv/repo", "repo"},
	}

	for _, tc := range tests {
		loc := ParseRepoLocation(tc.in)
		if loc.IsWSL != tc.isWSL {
			t.Errorf("ParseRepoLocation(%q).IsWSL = %v, want %v", tc.in, loc.IsWSL, tc.isWSL)
		}
		if loc.Distro != tc.distro {
			t.Errorf("ParseRepoLocation(%q).Distro = %q, want %q", tc.in, loc.Distro, tc.distro)
		}
		if loc.LinuxPath != tc.linuxPath {
			t.Errorf("ParseRepoLocation(%q).LinuxPath = %q, want %q", tc.in, loc.LinuxPath, tc.linuxPath)
		}
		if loc.Name != tc.name {
			t.Errorf("ParseRepoLocation(%q).Name = %q, want %q", tc.in, loc.Name, tc.name)
		}
	}
}

func TestParseUnifiedDiff(t *testing.T) {
	raw := `diff --git a/hello.txt b/hello.txt
index 1111111..2222222 100644
--- a/hello.txt
+++ b/hello.txt
@@ -1,3 +1,4 @@
 line1
-line2
+line2 modified
+line3 added
 line4
`
	fd := ParseUnifiedDiff("hello.txt", raw)
	if fd.IsBinary {
		t.Fatal("expected text diff, got binary")
	}
	if fd.Additions != 2 || fd.Deletions != 1 {
		t.Fatalf("got +%d -%d, want +2 -1", fd.Additions, fd.Deletions)
	}
	if len(fd.Hunks) != 1 || len(fd.Hunks[0].Lines) != 5 {
		t.Fatalf("unexpected hunks: %+v", fd.Hunks)
	}
}

func TestGitEndToEndLocalRepo(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()

	loc, err := InitRepo(ctx, dir)
	if err != nil {
		t.Fatalf("InitRepo failed: %v", err)
	}

	// Configure local git user for test commit
	if _, stderr, err := RunGit(ctx, loc, "config", "user.name", "Test User"); err != nil {
		t.Fatalf("git config user.name failed: %s (%v)", stderr, err)
	}
	if _, stderr, err := RunGit(ctx, loc, "config", "user.email", "test@example.com"); err != nil {
		t.Fatalf("git config user.email failed: %s (%v)", stderr, err)
	}

	// Create file and check status
	filePath := filepath.Join(dir, "readme.md")
	if err := os.WriteFile(filePath, []byte("# Hello\nworld\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	st, err := GetRepoStatus(ctx, loc)
	if err != nil {
		t.Fatalf("GetRepoStatus failed: %v", err)
	}
	if len(st.Unstaged) != 1 || st.Unstaged[0].Path != "readme.md" || st.Unstaged[0].Status != "?" {
		t.Fatalf("unexpected unstaged status: %+v", st.Unstaged)
	}

	// Stage & Commit
	if err := StageAll(ctx, loc); err != nil {
		t.Fatalf("StageAll failed: %v", err)
	}
	res, err := Commit(ctx, loc, "feat: initial commit", "body line", false)
	if err != nil || !res.Success {
		t.Fatalf("Commit failed: %+v %v", res, err)
	}

	// History
	hist, err := GetCommitHistory(ctx, loc, "", "", 0, 100)
	if err != nil || len(hist.Commits) != 1 {
		t.Fatalf("GetCommitHistory failed: %+v %v", hist, err)
	}
	if hist.Commits[0].Subject != "feat: initial commit" {
		t.Fatalf("unexpected subject: %q", hist.Commits[0].Subject)
	}

	// Branch & Stash
	bRes, err := CreateBranch(ctx, loc, "feat/test", "", true)
	if err != nil || !bRes.Success {
		t.Fatalf("CreateBranch failed: %+v %v", bRes, err)
	}
	if err := os.WriteFile(filePath, []byte("# Hello\nmodified\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	sRes, err := StashPush(ctx, loc, "wip change", false)
	if err != nil || !sRes.Success {
		t.Fatalf("StashPush failed: %+v %v", sRes, err)
	}
	stashes, err := ListStashes(ctx, loc)
	if err != nil || len(stashes) != 1 {
		t.Fatalf("ListStashes failed: %+v %v", stashes, err)
	}
	popRes, err := StashPop(ctx, loc, "stash@{0}")
	if err != nil || !popRes.Success {
		t.Fatalf("StashPop failed: %+v %v", popRes, err)
	}

	rnRes, err := RenameBranch(ctx, loc, "feat/test", "feat/renamed")
	if err != nil || !rnRes.Success {
		t.Fatalf("RenameBranch failed: %+v %v", rnRes, err)
	}

	// Local Git config read/write
	cfgSave, err := SaveGitConfig(ctx, GitConfigUpdate{
		RepoPath:   loc.Path,
		Scope:      "local",
		UserName:   "Updated Name",
		UserEmail:  "updated@example.com",
		PullRebase: "true",
	})
	if err != nil || !cfgSave.Success {
		t.Fatalf("SaveGitConfig failed: %+v %v", cfgSave, err)
	}
	cfgBundle, err := GetGitConfig(ctx, loc.Path, "")
	if err != nil {
		t.Fatalf("GetGitConfig failed: %v", err)
	}
	if cfgBundle.Local.UserName != "Updated Name" || cfgBundle.Local.UserEmail != "updated@example.com" || cfgBundle.Local.PullRebase != "true" {
		t.Fatalf("unexpected local config: %+v", cfgBundle.Local)
	}

	// Second commit -> test RevertCommit and ResetToCommit
	_ = os.WriteFile(filepath.Join(dir, "extra.txt"), []byte("hello\n"), 0o644)
	_ = StageAll(ctx, loc)
	_, _ = Commit(ctx, loc, "feat: add extra", "", false)

	h2, _ := GetCommitHistory(ctx, loc, "", "", 0, 10)
	if len(h2.Commits) < 2 {
		t.Fatalf("expected 2 commits, got %d", len(h2.Commits))
	}
	rvRes, err := RevertCommit(ctx, loc, h2.Commits[0].Hash, false)
	if err != nil || !rvRes.Success {
		t.Fatalf("RevertCommit failed: %+v %v", rvRes, err)
	}
	tree, err := GetCommitTree(ctx, loc, h2.Commits[0].Hash)
	if err != nil || len(tree) != 2 {
		t.Fatalf("GetCommitTree failed: %+v %v", tree, err)
	}
	fc, err := GetCommitFileContent(ctx, loc, h2.Commits[0].Hash, "extra.txt")
	if err != nil || fc.Content != "hello\n" {
		t.Fatalf("GetCommitFileContent failed: %+v %v", fc, err)
	}
	rsRes, err := ResetToCommit(ctx, loc, h2.Commits[1].Hash, "hard")
	if err != nil || !rsRes.Success {
		t.Fatalf("ResetToCommit failed: %+v %v", rsRes, err)
	}
}

func TestBrowseWSLDirLive(t *testing.T) {
	ctx := context.Background()
	distros, err := ListWSLDistros(ctx)
	if err != nil || len(distros) == 0 {
		t.Skip("No WSL2 distro available")
	}
	entries, resolved, err := BrowseWSLDir(ctx, distros[0].Name, "/")
	if err != nil {
		t.Fatalf("BrowseWSLDir(/) failed: %v", err)
	}
	if resolved != "/" {
		t.Fatalf("expected resolved=/, got %q", resolved)
	}
	if len(entries) == 0 {
		t.Fatalf("expected non-empty root entries for WSL2 /")
	}
	t.Logf("WSL %s / resolved=%q entries=%d first=%s", distros[0].Name, resolved, len(entries), entries[0].Path)

	// Test full Git operations in a temp WSL2 directory (ensures zsh shell never breaks git args)
	tmpWSL := fmt.Sprintf("/tmp/gitpulse_test_%d", os.Getpid())
	cleanup := exec.CommandContext(ctx, "wsl.exe", "-d", distros[0].Name, "-e", "rm", "-rf", tmpWSL)
	hideWindow(cleanup)
	_ = cleanup.Run()
	defer func() {
		c := exec.CommandContext(context.Background(), "wsl.exe", "-d", distros[0].Name, "-e", "rm", "-rf", tmpWSL)
		hideWindow(c)
		_ = c.Run()
	}()

	wLoc, err := InitRepo(ctx, "wsl://"+distros[0].Name+tmpWSL)
	if err != nil {
		t.Fatalf("WSL InitRepo failed: %v", err)
	}
	_, _, _ = RunGit(ctx, wLoc, "config", "user.name", "WSL Test")
	_, _, _ = RunGit(ctx, wLoc, "config", "user.email", "wsl@example.com")
	if err := WriteRepoFile(ctx, wLoc, "hello.txt", "hi wsl\n"); err != nil {
		t.Fatalf("WSL WriteRepoFile failed: %v", err)
	}
	if err := StageAll(ctx, wLoc); err != nil {
		t.Fatalf("WSL StageAll failed: %v", err)
	}
	if cRes, err := Commit(ctx, wLoc, "feat: wsl commit", "", false); err != nil || !cRes.Success {
		t.Fatalf("WSL Commit failed: %+v %v", cRes, err)
	}
	if brs, err := ListBranches(ctx, wLoc); err != nil || len(brs) == 0 {
		t.Fatalf("WSL ListBranches failed: %+v err=%v", brs, err)
	}
	if _, err := GetRepoStatus(ctx, wLoc); err != nil {
		t.Fatalf("WSL GetRepoStatus failed: %v", err)
	}
	if hist, err := GetCommitHistory(ctx, wLoc, "", "", 0, 10); err != nil || len(hist.Commits) != 1 {
		t.Fatalf("WSL GetCommitHistory failed: %+v err=%v", hist, err)
	}
}

func TestGitMergeConflictAndAbort(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()

	loc, err := InitRepo(ctx, dir)
	if err != nil {
		t.Fatalf("InitRepo failed: %v", err)
	}
	_, _, _ = RunGit(ctx, loc, "config", "user.name", "Test User")
	_, _, _ = RunGit(ctx, loc, "config", "user.email", "test@example.com")

	f := filepath.Join(dir, "app.txt")
	_ = os.WriteFile(f, []byte("line1\nbase\nline3\n"), 0o644)
	_ = StageAll(ctx, loc)
	_, _ = Commit(ctx, loc, "base", "", false)

	// Create branch feature and edit line2
	_, _ = CreateBranch(ctx, loc, "feature", "", true)
	_ = os.WriteFile(f, []byte("line1\ntheirs\nline3\n"), 0o644)
	_ = StageAll(ctx, loc)
	_, _ = Commit(ctx, loc, "feature edit", "", false)

	// Switch back to default branch
	branches, err := ListBranches(ctx, loc)
	if err != nil {
		t.Fatalf("ListBranches failed: %v", err)
	}
	var baseBranch string
	for _, b := range branches {
		if !b.IsRemote && b.Name != "feature" {
			baseBranch = b.Name
			break
		}
	}
	if baseBranch == "" {
		t.Fatalf("could not find base branch in %+v", branches)
	}
	ckRes, err := CheckoutBranch(ctx, loc, baseBranch, false)
	if err != nil || !ckRes.Success {
		t.Fatalf("CheckoutBranch(%q) failed: %+v err=%v", baseBranch, ckRes, err)
	}
	_ = os.WriteFile(f, []byte("line1\nours\nline3\n"), 0o644)
	_ = StageAll(ctx, loc)
	_, _ = Commit(ctx, loc, "base edit", "", false)

	// Merge feature -> expect CONFLICT
	mRes, err := MergeBranch(ctx, loc, "feature")
	if err != nil {
		t.Fatalf("MergeBranch error: %v", err)
	}
	if mRes.Success || mRes.ErrorCode != "CONFLICT" {
		t.Fatalf("expected CONFLICT, got: %+v", mRes)
	}

	st, err := GetRepoStatus(ctx, loc)
	if err != nil || len(st.Conflicted) != 1 || st.MergeState != "merge" {
		t.Fatalf("expected 1 conflicted file and merge state, got: %+v err=%v", st, err)
	}

	cf, err := GetConflictFile(ctx, loc, "app.txt")
	if err != nil || !cf.HasConflicts || len(cf.Blocks) != 1 {
		t.Fatalf("GetConflictFile failed: %+v err=%v", cf, err)
	}

	abRes, err := AbortMerge(ctx, loc)
	if err != nil || !abRes.Success {
		t.Fatalf("AbortMerge failed: %+v err=%v", abRes, err)
	}
}

func TestTagLifecycleAndRemotePushDelete(t *testing.T) {
	ctx := context.Background()
	bareDir := t.TempDir()
	workDir := t.TempDir()

	// Initialize bare remote
	bareLoc := ParseRepoLocation(bareDir)
	if _, stderr, err := RunGit(ctx, bareLoc, "init", "--bare"); err != nil {
		t.Fatalf("bare init failed: %s (%v)", stderr, err)
	}

	loc, err := InitRepo(ctx, workDir)
	if err != nil {
		t.Fatalf("InitRepo failed: %v", err)
	}
	_, _, _ = RunGit(ctx, loc, "config", "user.name", "Test User")
	_, _, _ = RunGit(ctx, loc, "config", "user.email", "test@example.com")
	if res, err := SetRemoteURL(ctx, loc, "origin", bareDir); err != nil || !res.Success {
		t.Fatalf("SetRemoteURL failed: %+v %v", res, err)
	}

	_ = os.WriteFile(filepath.Join(workDir, "main.txt"), []byte("v1\n"), 0o644)
	_ = StageAll(ctx, loc)
	if res, err := Commit(ctx, loc, "release 1", "", false); err != nil || !res.Success {
		t.Fatalf("Commit 1 failed: %+v %v", res, err)
	}

	if res, err := CreateTag(ctx, loc, "v1.0.0", "", "First release"); err != nil || !res.Success {
		t.Fatalf("CreateTag failed: %+v %v", res, err)
	}
	headShort, _, err := RunGit(ctx, loc, "rev-parse", "--short", "HEAD")
	if err != nil {
		t.Fatalf("rev-parse HEAD failed: %v", err)
	}
	tags, err := ListTags(ctx, loc)
	if err != nil || len(tags) != 1 || tags[0].Name != "v1.0.0" {
		t.Fatalf("ListTags unexpected: %+v err=%v", tags, err)
	}
	if tags[0].Hash != strings.TrimSpace(headShort) {
		t.Fatalf("expected annotated tag hash %q to match peeled commit %q", tags[0].Hash, strings.TrimSpace(headShort))
	}

	if res, err := PushTag(ctx, loc, "", "v1.0.0"); err != nil || !res.Success {
		t.Fatalf("PushTag failed: %+v %v", res, err)
	}
	// Verify tag exists on bare remote
	if out, stderr, err := RunGit(ctx, bareLoc, "tag", "-l"); err != nil || out == "" {
		t.Fatalf("expected tag on remote, got %q stderr=%s err=%v", out, stderr, err)
	}

	// Second commit, then checkout tag (detached HEAD)
	_ = os.WriteFile(filepath.Join(workDir, "main.txt"), []byte("v2\n"), 0o644)
	_ = StageAll(ctx, loc)
	_, _ = Commit(ctx, loc, "commit 2", "", false)

	if res, err := CheckoutTag(ctx, loc, "v1.0.0"); err != nil || !res.Success {
		t.Fatalf("CheckoutTag failed: %+v %v", res, err)
	}

	// Delete remote tag, then delete local tag
	if res, err := DeleteRemoteTag(ctx, loc, "origin", "v1.0.0"); err != nil || !res.Success {
		t.Fatalf("DeleteRemoteTag failed: %+v %v", res, err)
	}
	if res, err := DeleteTag(ctx, loc, "v1.0.0"); err != nil || !res.Success {
		t.Fatalf("DeleteTag failed: %+v %v", res, err)
	}
	tagsAfter, err := ListTags(ctx, loc)
	if err != nil || len(tagsAfter) != 0 {
		t.Fatalf("expected 0 tags after delete, got: %+v err=%v", tagsAfter, err)
	}
}

func TestAmbiguousLocalBranchNamedOrigin(t *testing.T) {
	ctx := context.Background()
	bareDir := t.TempDir()
	workDir := t.TempDir()

	bareLoc := ParseRepoLocation(bareDir)
	if _, stderr, err := RunGit(ctx, bareLoc, "init", "--bare"); err != nil {
		t.Fatalf("bare init failed: %s (%v)", stderr, err)
	}

	loc, err := InitRepo(ctx, workDir)
	if err != nil {
		t.Fatalf("InitRepo failed: %v", err)
	}
	_, _, _ = RunGit(ctx, loc, "config", "user.name", "Test User")
	_, _, _ = RunGit(ctx, loc, "config", "user.email", "test@example.com")
	_, _ = SetRemoteURL(ctx, loc, "origin", bareDir)

	_ = os.WriteFile(filepath.Join(workDir, "f.txt"), []byte("1\n"), 0o644)
	_ = StageAll(ctx, loc)
	_, _ = Commit(ctx, loc, "init", "", false)

	// Push default branch and create refs/remotes/origin/HEAD so "origin" ref is ambiguous
	_, _, _ = RunGit(ctx, loc, "push", "-u", "origin", "HEAD")
	_, _, _ = RunGit(ctx, loc, "remote", "set-head", "origin", "-a")

	// Create a local branch literally named "origin" (which git formats as heads/origin)
	if res, err := CreateBranch(ctx, loc, "origin", "", false); err != nil || !res.Success {
		t.Fatalf("CreateBranch(origin) failed: %+v err=%v", res, err)
	}

	branches, err := ListBranches(ctx, loc)
	if err != nil {
		t.Fatalf("ListBranches failed: %v", err)
	}
	var foundOriginLocal bool
	for _, b := range branches {
		if !b.IsRemote && b.FullName == "refs/heads/origin" {
			foundOriginLocal = true
			if b.Name != "origin" {
				t.Fatalf("expected local branch Name=%q, got %q", "origin", b.Name)
			}
		}
	}
	if !foundOriginLocal {
		t.Fatalf("expected refs/heads/origin in branches: %+v", branches)
	}

	// Ensure Deleting the branch using b.Name succeeds cleanly
	if res, err := DeleteBranch(ctx, loc, "origin", true); err != nil || !res.Success {
		t.Fatalf("DeleteBranch(origin) failed: %+v err=%v", res, err)
	}
}

func TestGetCommitHistoryMissingOrAmbiguousRef(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()

	loc, err := InitRepo(ctx, dir)
	if err != nil {
		t.Fatalf("InitRepo failed: %v", err)
	}
	_, _, _ = RunGit(ctx, loc, "config", "user.name", "Test User")
	_, _, _ = RunGit(ctx, loc, "config", "user.email", "test@example.com")

	// Create a file whose name could collide with a branch name without "--"
	_ = os.WriteFile(filepath.Join(dir, "readme.md"), []byte("hello\n"), 0o644)
	_ = StageAll(ctx, loc)
	if res, err := Commit(ctx, loc, "init", "", false); err != nil || !res.Success {
		t.Fatalf("Commit failed: %+v err=%v", res, err)
	}

	if res, err := CreateBranch(ctx, loc, "readme.md", "", false); err != nil || !res.Success {
		t.Fatalf("CreateBranch failed: %+v err=%v", res, err)
	}
	histBranch, err := GetCommitHistory(ctx, loc, "refs/heads/readme.md", "", 0, 50)
	if err != nil || len(histBranch.Commits) != 1 {
		t.Fatalf("GetCommitHistory for branch matching file failed: %+v err=%v", histBranch, err)
	}

	// Non-existent / deleted branch ref should fall back cleanly rather than erroring
	histMissing, err := GetCommitHistory(ctx, loc, "refs/heads/zhangxing/perm", "", 0, 50)
	if err != nil || len(histMissing.Commits) != 1 {
		t.Fatalf("GetCommitHistory for deleted/missing ref failed: %+v err=%v", histMissing, err)
	}
}

func TestGetCommitDetailAndDiffForMergeCommit(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()

	loc, err := InitRepo(ctx, dir)
	if err != nil {
		t.Fatalf("InitRepo failed: %v", err)
	}
	_, _, _ = RunGit(ctx, loc, "config", "user.name", "Test User")
	_, _, _ = RunGit(ctx, loc, "config", "user.email", "test@example.com")

	_ = os.WriteFile(filepath.Join(dir, "base.txt"), []byte("base\n"), 0o644)
	_ = StageAll(ctx, loc)
	if res, err := Commit(ctx, loc, "init", "", false); err != nil || !res.Success {
		t.Fatalf("init commit failed: %+v err=%v", res, err)
	}

	if res, err := CreateBranch(ctx, loc, "feat/merge-test", "", true); err != nil || !res.Success {
		t.Fatalf("CreateBranch failed: %+v err=%v", res, err)
	}
	_ = os.WriteFile(filepath.Join(dir, "feature.txt"), []byte("line1\nline2\n"), 0o644)
	_ = StageAll(ctx, loc)
	if res, err := Commit(ctx, loc, "feat: add feature.txt", "", false); err != nil || !res.Success {
		t.Fatalf("feature commit failed: %+v err=%v", res, err)
	}

	branches, err := ListBranches(ctx, loc)
	if err != nil {
		t.Fatalf("ListBranches failed: %v", err)
	}
	mainBranch := ""
	for _, b := range branches {
		if !b.IsRemote && !b.IsCurrent {
			mainBranch = b.Name
			break
		}
	}
	if mainBranch == "" {
		t.Fatalf("could not find initial branch in %+v", branches)
	}
	if res, err := CheckoutBranch(ctx, loc, mainBranch, false); err != nil || !res.Success {
		t.Fatalf("CheckoutBranch(%s) failed: %+v err=%v", mainBranch, res, err)
	}
	// Make an independent commit on mainBranch so merge commit has distinct changes on ^1 vs ^2
	_ = os.WriteFile(filepath.Join(dir, "main_only.txt"), []byte("main\n"), 0o644)
	_ = StageAll(ctx, loc)
	if res, err := Commit(ctx, loc, "chore: main only change", "", false); err != nil || !res.Success {
		t.Fatalf("main commit failed: %+v err=%v", res, err)
	}
	if _, stderr, err := RunGit(ctx, loc, "merge", "--no-ff", "-m", "Merge feat/merge-test", "feat/merge-test"); err != nil {
		t.Fatalf("git merge --no-ff failed: %s (%v)", stderr, err)
	}

	hist, err := GetCommitHistory(ctx, loc, "", "", 0, 10)
	if err != nil || len(hist.Commits) == 0 {
		t.Fatalf("GetCommitHistory failed: %+v err=%v", hist, err)
	}
	mergeHash := hist.Commits[0].Hash

	detail, err := GetCommitDetail(ctx, loc, mergeHash)
	if err != nil {
		t.Fatalf("GetCommitDetail failed: %v", err)
	}
	if len(detail.Parents) != 2 {
		t.Fatalf("expected 2 parents on merge commit, got %+v", detail.Parents)
	}
	if len(detail.Files) != 1 || detail.Files[0].Path != "feature.txt" || detail.Files[0].Additions != 2 {
		t.Fatalf("expected feature.txt (+2) in merge commit detail, got %+v", detail.Files)
	}

	fd, err := GetCommitFileDiff(ctx, loc, mergeHash, "feature.txt", false)
	if err != nil {
		t.Fatalf("GetCommitFileDiff failed: %v", err)
	}
	if fd.Additions != 2 || len(fd.Hunks) == 0 {
		t.Fatalf("expected diff hunks for merge commit file, got %+v", fd)
	}
}

func TestGetCommitHistoryDateOrderAndExcludeStash(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()

	loc, err := InitRepo(ctx, dir)
	if err != nil {
		t.Fatalf("InitRepo failed: %v", err)
	}
	_, _, _ = RunGit(ctx, loc, "config", "user.name", "Test User")
	_, _, _ = RunGit(ctx, loc, "config", "user.email", "test@example.com")

	commitWithDate := func(file, content, msg, isoDate string) {
		_ = os.WriteFile(filepath.Join(dir, file), []byte(content), 0o644)
		_ = StageAll(ctx, loc)
		cmd := exec.CommandContext(ctx, "git", "commit", "-m", msg)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_DATE="+isoDate,
			"GIT_COMMITTER_DATE="+isoDate,
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("commit %q failed: %s (%v)", msg, string(out), err)
		}
	}

	commitWithDate("a.txt", "1\n", "base commit", "2025-01-01T10:00:00Z")

	// Older parallel branch whose ref name ("aaa-old") sorts before main/master
	if res, err := CreateBranch(ctx, loc, "aaa-old", "", true); err != nil || !res.Success {
		t.Fatalf("CreateBranch failed: %+v err=%v", res, err)
	}
	commitWithDate("old.txt", "old\n", "old parallel commit", "2025-01-02T10:00:00Z")

	branches, err := ListBranches(ctx, loc)
	if err != nil {
		t.Fatalf("ListBranches failed: %v", err)
	}
	mainBranch := ""
	for _, b := range branches {
		if !b.IsRemote && !b.IsCurrent {
			mainBranch = b.Name
			break
		}
	}
	if mainBranch == "" {
		t.Fatalf("could not find initial branch in %+v", branches)
	}
	if res, err := CheckoutBranch(ctx, loc, mainBranch, false); err != nil || !res.Success {
		t.Fatalf("CheckoutBranch(%s) failed: %+v err=%v", mainBranch, res, err)
	}
	// Make a newer commit on mainBranch (and ensure committer timestamp is newer via env)
	_ = os.WriteFile(filepath.Join(dir, "new.txt"), []byte("new\n"), 0o644)
	_ = StageAll(ctx, loc)
	cmd := exec.CommandContext(ctx, "git", "commit", "-m", "latest main commit")
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_DATE=2026-06-01T10:00:00Z",
		"GIT_COMMITTER_DATE=2026-06-01T10:00:00Z",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("latest commit failed: %s (%v)", string(out), err)
	}

	// Create a stash that must NOT appear in All Commits history
	_ = os.WriteFile(filepath.Join(dir, "new.txt"), []byte("stashed\n"), 0o644)
	if res, err := StashPush(ctx, loc, "temp stash", false); err != nil || !res.Success {
		t.Fatalf("StashPush failed: %+v err=%v", res, err)
	}

	hist, err := GetCommitHistory(ctx, loc, "__ALL__", "", 0, 20)
	if err != nil {
		t.Fatalf("GetCommitHistory failed: %v", err)
	}
	if len(hist.Commits) != 3 {
		t.Fatalf("expected 3 commits (excluding stash), got %d: %+v", len(hist.Commits), hist.Commits)
	}
	if hist.Commits[0].Subject != "latest main commit" {
		t.Fatalf("expected newest commit at top, got %q", hist.Commits[0].Subject)
	}
}

func TestPushRemoteErrorClassificationAndSetRemoteURL(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()

	loc, err := InitRepo(ctx, dir)
	if err != nil {
		t.Fatalf("InitRepo failed: %v", err)
	}
	_, _, _ = RunGit(ctx, loc, "config", "user.name", "Test User")
	_, _, _ = RunGit(ctx, loc, "config", "user.email", "test@example.com")

	if err := os.WriteFile(filepath.Join(dir, "readme.txt"), []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := StageAll(ctx, loc); err != nil {
		t.Fatal(err)
	}
	if res, err := Commit(ctx, loc, "initial commit", "", false); err != nil || !res.Success {
		t.Fatalf("Commit failed: %+v err=%v", res, err)
	}

	// 1. No remote configured -> NO_REMOTE
	pushRes, err := Push(ctx, loc)
	if err != nil {
		t.Fatalf("Push returned err=%v", err)
	}
	if pushRes.Success || pushRes.ErrorCode != "NO_REMOTE" {
		t.Fatalf("expected NO_REMOTE error code on push with no remote, got %+v", pushRes)
	}

	// 2. SetRemoteURL adds origin when missing
	missingRepo := filepath.Join(t.TempDir(), "does-not-exist.git")
	setRes, err := SetRemoteURL(ctx, loc, "origin", missingRepo)
	if err != nil || !setRes.Success {
		t.Fatalf("SetRemoteURL add failed: %+v err=%v", setRes, err)
	}

	// 3. Invalid non-HTTP remote target -> REMOTE_ACCESS_ERROR
	pushRes2, err := Push(ctx, loc)
	if err != nil {
		t.Fatalf("Push returned err=%v", err)
	}
	if pushRes2.Success || pushRes2.ErrorCode != "REMOTE_ACCESS_ERROR" {
		t.Fatalf("expected REMOTE_ACCESS_ERROR for missing target repo, got %+v", pushRes2)
	}

	// 4. Updating existing remote to HTTPS still classifies push failures as HTTPS_REMOTE
	setRes2, err := SetRemoteURL(ctx, loc, "origin", "https://github.com/example/nonexistent.git")
	if err != nil || !setRes2.Success {
		t.Fatalf("SetRemoteURL update failed: %+v err=%v", setRes2, err)
	}
	cls := classifyPushError(ctx, loc, "origin", "", "fatal: could not read Username", fmt.Errorf("exit 128"))
	if cls.ErrorCode != "HTTPS_REMOTE" {
		t.Fatalf("expected HTTPS_REMOTE, got %+v", cls)
	}
}

func TestGetConflictFileDiff3AndResolveSide(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()

	loc, err := InitRepo(ctx, dir)
	if err != nil {
		t.Fatalf("InitRepo failed: %v", err)
	}
	_, _, _ = RunGit(ctx, loc, "config", "user.name", "Test User")
	_, _, _ = RunGit(ctx, loc, "config", "user.email", "test@example.com")
	_, _, _ = RunGit(ctx, loc, "config", "merge.conflictstyle", "diff3")

	_ = os.WriteFile(filepath.Join(dir, "conf.txt"), []byte("header\noriginal line\nfooter\n"), 0o644)
	_ = StageAll(ctx, loc)
	_, _ = Commit(ctx, loc, "base", "", false)

	if res, err := CreateBranch(ctx, loc, "feat", "", true); err != nil || !res.Success {
		t.Fatalf("CreateBranch failed: %+v err=%v", res, err)
	}
	_ = os.WriteFile(filepath.Join(dir, "conf.txt"), []byte("header\nfeat line\nfooter\n"), 0o644)
	_ = StageAll(ctx, loc)
	_, _ = Commit(ctx, loc, "feat change", "", false)

	branches, _ := ListBranches(ctx, loc)
	mainBranch := ""
	for _, b := range branches {
		if !b.IsRemote && !b.IsCurrent {
			mainBranch = b.Name
			break
		}
	}
	_, _ = CheckoutBranch(ctx, loc, mainBranch, false)
	_ = os.WriteFile(filepath.Join(dir, "conf.txt"), []byte("header\nmain line\nfooter\n"), 0o644)
	_ = StageAll(ctx, loc)
	_, _ = Commit(ctx, loc, "main change", "", false)

	mRes, err := MergeBranch(ctx, loc, "feat")
	if err != nil || mRes.ErrorCode != "CONFLICT" {
		t.Fatalf("expected merge conflict, got %+v err=%v", mRes, err)
	}

	cf, err := GetConflictFile(ctx, loc, "conf.txt")
	if err != nil || len(cf.Blocks) != 1 {
		t.Fatalf("expected 1 diff3 conflict block, got %+v err=%v", cf, err)
	}
	b := cf.Blocks[0]
	if len(b.OursLines) != 1 || b.OursLines[0] != "main line" {
		t.Fatalf("expected OursLines=[main line], got %+v", b.OursLines)
	}
	if len(b.BaseLines) != 1 || b.BaseLines[0] != "original line" {
		t.Fatalf("expected BaseLines=[original line], got %+v", b.BaseLines)
	}
	if len(b.TheirsLines) != 1 || b.TheirsLines[0] != "feat line" {
		t.Fatalf("expected TheirsLines=[feat line], got %+v", b.TheirsLines)
	}

	resSide, err := ResolveConflictSide(ctx, loc, "conf.txt", "theirs")
	if err != nil || !resSide.Success {
		t.Fatalf("ResolveConflictSide failed: %+v err=%v", resSide, err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "conf.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.ReplaceAll(string(data), "\r\n", "\n") != "header\nfeat line\nfooter\n" {
		t.Fatalf("unexpected resolved file contents: %q", string(data))
	}
	st, err := GetRepoStatus(ctx, loc)
	if err != nil || len(st.Conflicted) != 0 {
		t.Fatalf("expected 0 conflicted files after ResolveConflictSide, got %+v err=%v", st, err)
	}
}

func TestPullNoRemoteAndNoUpstreamRecovery(t *testing.T) {
	ctx := context.Background()
	bareDir := t.TempDir()
	workDir := t.TempDir()

	bareLoc := ParseRepoLocation(bareDir)
	if _, stderr, err := RunGit(ctx, bareLoc, "init", "--bare"); err != nil {
		t.Fatalf("bare init failed: %s (%v)", stderr, err)
	}

	loc, err := InitRepo(ctx, workDir)
	if err != nil {
		t.Fatalf("InitRepo failed: %v", err)
	}
	_, _, _ = RunGit(ctx, loc, "config", "user.name", "Test User")
	_, _, _ = RunGit(ctx, loc, "config", "user.email", "test@example.com")

	_ = os.WriteFile(filepath.Join(workDir, "f.txt"), []byte("v1\n"), 0o644)
	_ = StageAll(ctx, loc)
	_, _ = Commit(ctx, loc, "init", "", false)

	// 1. Fetch & Pull with no remote configured -> NO_REMOTE
	fRes, err := Fetch(ctx, loc)
	if err != nil || fRes.Success || fRes.ErrorCode != "NO_REMOTE" {
		t.Fatalf("expected Fetch NO_REMOTE, got %+v err=%v", fRes, err)
	}
	pRes, err := Pull(ctx, loc)
	if err != nil || pRes.Success || pRes.ErrorCode != "NO_REMOTE" {
		t.Fatalf("expected Pull NO_REMOTE, got %+v err=%v", pRes, err)
	}

	// 2. Configure remote and push initial branch so bare remote has that branch
	if res, err := SetRemoteURL(ctx, loc, "origin", bareDir); err != nil || !res.Success {
		t.Fatalf("SetRemoteURL failed: %+v err=%v", res, err)
	}
	if pushRes, err := Push(ctx, loc); err != nil || !pushRes.Success {
		t.Fatalf("Push failed: %+v err=%v", pushRes, err)
	}

	// Determine pushed branch name
	bOut, _, _ := RunGit(ctx, loc, "rev-parse", "--abbrev-ref", "HEAD")
	baseBranch := strings.TrimSpace(bOut)

	// 3. Create new local branch "1" with no upstream -> Pull returns NO_UPSTREAM
	if res, err := CreateBranch(ctx, loc, "1", "", true); err != nil || !res.Success {
		t.Fatalf("CreateBranch failed: %+v err=%v", res, err)
	}
	pRes2, err := Pull(ctx, loc)
	if err != nil || pRes2.Success || pRes2.ErrorCode != "NO_UPSTREAM" {
		t.Fatalf("expected Pull NO_UPSTREAM on untracked branch, got %+v err=%v", pRes2, err)
	}

	// 4. SetBranchUpstream links "1" -> "origin/<baseBranch>" and Pull then succeeds
	upRes, err := SetBranchUpstream(ctx, loc, "1", "origin", baseBranch)
	if err != nil || !upRes.Success {
		t.Fatalf("SetBranchUpstream failed: %+v err=%v", upRes, err)
	}
	pRes3, err := Pull(ctx, loc)
	if err != nil || !pRes3.Success {
		t.Fatalf("expected Pull to succeed after setting upstream, got %+v err=%v", pRes3, err)
	}
}

func TestGetMergeCommitMessage(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()

	loc, err := InitRepo(ctx, dir)
	if err != nil {
		t.Fatalf("InitRepo failed: %v", err)
	}
	_, _, _ = RunGit(ctx, loc, "config", "user.name", "Test User")
	_, _, _ = RunGit(ctx, loc, "config", "user.email", "test@example.com")

	_ = os.WriteFile(filepath.Join(dir, "app.txt"), []byte("base\n"), 0o644)
	_ = StageAll(ctx, loc)
	_, _ = Commit(ctx, loc, "base", "", false)

	_, _ = CreateBranch(ctx, loc, "feat", "", true)
	_ = os.WriteFile(filepath.Join(dir, "app.txt"), []byte("feat\n"), 0o644)
	_ = StageAll(ctx, loc)
	_, _ = Commit(ctx, loc, "feat work", "", false)

	branches, _ := ListBranches(ctx, loc)
	mainBranch := ""
	for _, b := range branches {
		if !b.IsRemote && !b.IsCurrent {
			mainBranch = b.Name
			break
		}
	}
	_, _ = CheckoutBranch(ctx, loc, mainBranch, false)
	_ = os.WriteFile(filepath.Join(dir, "app.txt"), []byte("main\n"), 0o644)
	_ = StageAll(ctx, loc)
	_, _ = Commit(ctx, loc, "main work", "", false)

	mRes, err := MergeBranch(ctx, loc, "feat")
	if err != nil || mRes.ErrorCode != "CONFLICT" {
		t.Fatalf("expected conflict, got %+v err=%v", mRes, err)
	}

	if resSide, err := ResolveConflictSide(ctx, loc, "app.txt", "ours"); err != nil || !resSide.Success {
		t.Fatalf("ResolveConflictSide failed: %+v err=%v", resSide, err)
	}

	sum, desc, err := GetMergeCommitMessage(ctx, loc)
	if err != nil {
		t.Fatalf("GetMergeCommitMessage failed: %v", err)
	}
	if sum != "Merge branch 'feat'" {
		t.Fatalf("expected 'Merge branch \\'feat\\'', got %q (desc=%q)", sum, desc)
	}

	// Commit with empty index diff (since ours matched HEAD) still finishes merge
	cRes, err := Commit(ctx, loc, sum, desc, false)
	if err != nil || !cRes.Success {
		t.Fatalf("Commit after resolving to ours failed: %+v err=%v", cRes, err)
	}
	st, err := GetRepoStatus(ctx, loc)
	if err != nil || st.MergeState != "" {
		t.Fatalf("expected clean merge state after commit, got %+v err=%v", st, err)
	}
}

func TestListBranchesBatchUnpushedAheadCounts(t *testing.T) {
	ctx := context.Background()
	bareDir := t.TempDir()
	workDir := t.TempDir()

	bareLoc := ParseRepoLocation(bareDir)
	if _, stderr, err := RunGit(ctx, bareLoc, "init", "--bare"); err != nil {
		t.Fatalf("bare init failed: %s (%v)", stderr, err)
	}

	loc, err := InitRepo(ctx, workDir)
	if err != nil {
		t.Fatalf("InitRepo failed: %v", err)
	}
	_, _, _ = RunGit(ctx, loc, "config", "user.name", "Test User")
	_, _, _ = RunGit(ctx, loc, "config", "user.email", "test@example.com")
	if res, err := SetRemoteURL(ctx, loc, "origin", bareDir); err != nil || !res.Success {
		t.Fatalf("SetRemoteURL failed: %+v err=%v", res, err)
	}

	commitFile := func(name, content, msg string) {
		if err := os.WriteFile(filepath.Join(workDir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := StageAll(ctx, loc); err != nil {
			t.Fatal(err)
		}
		if res, err := Commit(ctx, loc, msg, "", false); err != nil || !res.Success {
			t.Fatalf("Commit %q failed: %+v err=%v", msg, res, err)
		}
	}

	// Base commit c0 -> c1 pushed to origin
	commitFile("a.txt", "0\n", "c0")
	// Untracked local branch pointing at ancestor of origin (ahead=0)
	if res, err := CreateBranch(ctx, loc, "local-behind-remote", "", false); err != nil || !res.Success {
		t.Fatalf("CreateBranch failed: %+v err=%v", res, err)
	}

	commitFile("a.txt", "1\n", "c1")
	if pushRes, err := Push(ctx, loc); err != nil || !pushRes.Success {
		t.Fatalf("Push failed: %+v err=%v", pushRes, err)
	}

	// Untracked local branch at exact remote tip (ahead=0)
	if res, err := CreateBranch(ctx, loc, "local-same-as-remote", "", false); err != nil || !res.Success {
		t.Fatalf("CreateBranch failed: %+v err=%v", res, err)
	}

	// Untracked branch A with 2 unpushed commits
	if res, err := CreateBranch(ctx, loc, "local-ahead-2", "", true); err != nil || !res.Success {
		t.Fatalf("CreateBranch failed: %+v err=%v", res, err)
	}
	commitFile("b.txt", "1\n", "a1")
	commitFile("b.txt", "2\n", "a2")

	// Untracked branch B sharing a1, with its own commit b2 -> ahead=2
	if res, err := CreateBranch(ctx, loc, "local-shared-ahead-2", "local-ahead-2~1", true); err != nil || !res.Success {
		t.Fatalf("CreateBranch failed: %+v err=%v", res, err)
	}
	commitFile("c.txt", "1\n", "b2")

	// Untracked branch C merging local-ahead-2 into local-shared-ahead-2 -> a1, a2, b2, merge = ahead=4
	if res, err := CreateBranch(ctx, loc, "local-merge-ahead-4", "", true); err != nil || !res.Success {
		t.Fatalf("CreateBranch failed: %+v err=%v", res, err)
	}
	if _, stderr, err := RunGit(ctx, loc, "merge", "--no-ff", "-m", "merge a into b", "local-ahead-2"); err != nil {
		t.Fatalf("merge failed: %s (%v)", stderr, err)
	}

	branches, err := ListBranches(ctx, loc)
	if err != nil {
		t.Fatalf("ListBranches failed: %v", err)
	}
	got := make(map[string]int)
	for _, b := range branches {
		if !b.IsRemote {
			got[b.Name] = b.Ahead
		}
	}

	want := map[string]int{
		"local-behind-remote":  0,
		"local-same-as-remote": 0,
		"local-ahead-2":        2,
		"local-shared-ahead-2": 2,
		"local-merge-ahead-4":  4,
	}
	for name, expected := range want {
		if got[name] != expected {
			t.Errorf("branch %q Ahead = %d, want %d (all=%+v)", name, got[name], expected, got)
		}
	}
}

func TestFormatCommitDateAndRelativeTime(t *testing.T) {
	now := time.Date(2026, 11, 26, 16, 20, 30, 0, time.Local)
	if got := formatCommitDate(now, now); got != "2026-11-26 16:20:30" {
		t.Fatalf("formatCommitDate = %q, want 2026-11-26 16:20:30", got)
	}
	cases := []struct {
		delta time.Duration
		want  string
	}{
		{10 * time.Second, "刚刚"},
		{5 * time.Minute, "5 分钟前"},
		{3 * time.Hour, "3 小时前"},
		{24 * time.Hour, "1 天前"},
		{45 * 24 * time.Hour, "1 个月前"},
		{400 * 24 * time.Hour, "1 年前"},
	}
	for _, tc := range cases {
		if got := formatRelativeTime(now, now.Add(-tc.delta)); got != tc.want {
			t.Errorf("formatRelativeTime(-%v) = %q, want %q", tc.delta, got, tc.want)
		}
	}
}

func TestGetRepoStatusIgnoreWhitespace(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()

	loc, err := InitRepo(ctx, dir)
	if err != nil {
		t.Fatalf("InitRepo failed: %v", err)
	}
	if _, stderr, err := RunGit(ctx, loc, "config", "user.name", "Test User"); err != nil {
		t.Fatalf("git config user.name failed: %s (%v)", stderr, err)
	}
	if _, stderr, err := RunGit(ctx, loc, "config", "user.email", "test@example.com"); err != nil {
		t.Fatalf("git config user.email failed: %s (%v)", stderr, err)
	}
	if _, stderr, err := RunGit(ctx, loc, "config", "core.autocrlf", "false"); err != nil {
		t.Fatalf("git config core.autocrlf failed: %s (%v)", stderr, err)
	}

	wsFile := filepath.Join(dir, "ws.txt")
	realFile := filepath.Join(dir, "real.txt")
	if err := os.WriteFile(wsFile, []byte("hello world\nline two\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(realFile, []byte("alpha\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := StageAll(ctx, loc); err != nil {
		t.Fatal(err)
	}
	if res, err := Commit(ctx, loc, "init", "", false); err != nil || !res.Success {
		t.Fatalf("Commit failed: %+v %v", res, err)
	}

	// Make whitespace-only change to ws.txt (spaces, tabs, CRLF) and real change to real.txt
	if err := os.WriteFile(wsFile, []byte("  hello   world\t\r\nline  two \r\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(realFile, []byte("alpha\nbeta\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Also stage ws.txt? First test unstaged filtering
	stAll, err := GetRepoStatusWithOptions(ctx, loc, false)
	if err != nil {
		t.Fatalf("GetRepoStatusWithOptions(false) failed: %v", err)
	}
	if len(stAll.Unstaged) != 2 {
		t.Fatalf("expected 2 unstaged files without ignoreWhitespace, got %d (%+v)", len(stAll.Unstaged), stAll.Unstaged)
	}

	stNoWs, err := GetRepoStatusWithOptions(ctx, loc, true)
	if err != nil {
		t.Fatalf("GetRepoStatusWithOptions(true) failed: %v", err)
	}
	if len(stNoWs.Unstaged) != 1 || stNoWs.Unstaged[0].Path != "real.txt" {
		t.Fatalf("expected only real.txt unstaged when ignoreWhitespace=true, got %+v", stNoWs.Unstaged)
	}

	// Stage ws.txt and ensure staged whitespace-only changes are also filtered when ignoreWhitespace=true
	if err := StageFile(ctx, loc, "ws.txt"); err != nil {
		t.Fatal(err)
	}
	stStagedAll, err := GetRepoStatusWithOptions(ctx, loc, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(stStagedAll.Staged) != 1 || stStagedAll.Staged[0].Path != "ws.txt" {
		t.Fatalf("expected ws.txt staged when ignoreWhitespace=false, got %+v", stStagedAll.Staged)
	}
	stStagedNoWs, err := GetRepoStatusWithOptions(ctx, loc, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(stStagedNoWs.Staged) != 0 {
		t.Fatalf("expected 0 staged files when ignoreWhitespace=true, got %+v", stStagedNoWs.Staged)
	}
	if len(stStagedNoWs.Unstaged) != 1 || stStagedNoWs.Unstaged[0].Path != "real.txt" {
		t.Fatalf("expected real.txt unstaged, got %+v", stStagedNoWs.Unstaged)
	}
}

func TestGetRecentCommitMessages(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()

	loc, err := InitRepo(ctx, dir)
	if err != nil {
		t.Fatalf("InitRepo failed: %v", err)
	}
	if _, stderr, err := RunGit(ctx, loc, "config", "user.name", "Test User"); err != nil {
		t.Fatalf("git config user.name failed: %s (%v)", stderr, err)
	}
	if _, stderr, err := RunGit(ctx, loc, "config", "user.email", "test@example.com"); err != nil {
		t.Fatalf("git config user.email failed: %s (%v)", stderr, err)
	}

	// Empty repo should return empty slice without error
	emptyMsgs, err := GetRecentCommitMessages(ctx, loc, 10)
	if err != nil {
		t.Fatalf("GetRecentCommitMessages on empty repo failed: %v", err)
	}
	if len(emptyMsgs) != 0 {
		t.Fatalf("expected 0 messages on empty repo, got %d", len(emptyMsgs))
	}

	writeAndCommit := func(content, summary, body string) {
		if err := os.WriteFile(filepath.Join(dir, "file.txt"), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := StageAll(ctx, loc); err != nil {
			t.Fatal(err)
		}
		if res, err := Commit(ctx, loc, summary, body, false); err != nil || !res.Success {
			t.Fatalf("Commit(%q) failed: %+v %v", summary, res, err)
		}
	}

	writeAndCommit("v1\n", "feat: first commit", "detailed body")
	writeAndCommit("v2\n", "fix: duplicate subject", "")
	writeAndCommit("v3\n", "chore: middle commit", "")
	writeAndCommit("v4\n", "fix: duplicate subject", "")

	msgs, err := GetRecentCommitMessages(ctx, loc, 10)
	if err != nil {
		t.Fatalf("GetRecentCommitMessages failed: %v", err)
	}
	if len(msgs) != 3 {
		t.Fatalf("expected 3 deduplicated messages, got %d (%+v)", len(msgs), msgs)
	}
	if msgs[0].Subject != "fix: duplicate subject" || msgs[0].Body != "" {
		t.Fatalf("unexpected first message: %+v", msgs[0])
	}
	if msgs[1].Subject != "chore: middle commit" {
		t.Fatalf("unexpected second message: %+v", msgs[1])
	}
	if msgs[2].Subject != "feat: first commit" || msgs[2].Body != "detailed body" {
		t.Fatalf("unexpected third message: %+v", msgs[2])
	}
	if msgs[0].ShortHash == "" || msgs[0].Author != "Test User" {
		t.Fatalf("expected metadata populated: %+v", msgs[0])
	}

	limited, err := GetRecentCommitMessages(ctx, loc, 2)
	if err != nil {
		t.Fatalf("GetRecentCommitMessages(limit=2) failed: %v", err)
	}
	if len(limited) != 2 {
		t.Fatalf("expected 2 messages with limit=2, got %d", len(limited))
	}
}

func TestFormatGitCommand(t *testing.T) {
	got := FormatGitCommand([]string{"commit", "-m", "feat: add drag & echo", "-m", "line1\nline2"})
	want := `git commit -m "feat: add drag & echo" -m "line1\nline2"`
	if got != want {
		t.Fatalf("FormatGitCommand = %q, want %q", got, want)
	}

	gotEmpty := FormatGitCommand([]string{"commit", "-m", ""})
	if gotEmpty != `git commit -m ""` {
		t.Fatalf("FormatGitCommand empty arg = %q", gotEmpty)
	}
}

func TestCommandObserverEmitsForOpsOnly(t *testing.T) {
	var events []CommandEvent
	ctx := WithCommandObserver(context.Background(), func(ev CommandEvent) {
		events = append(events, ev)
	})

	dir := t.TempDir()
	loc, err := InitRepo(ctx, dir)
	if err != nil {
		t.Fatalf("InitRepo failed: %v", err)
	}
	if _, stderr, err := RunGit(ctx, loc, "config", "user.name", "Test User"); err != nil {
		t.Fatalf("config user.name failed: %s (%v)", stderr, err)
	}
	if _, stderr, err := RunGit(ctx, loc, "config", "user.email", "test@example.com"); err != nil {
		t.Fatalf("config user.email failed: %s (%v)", stderr, err)
	}

	// Read-only query should NOT emit events
	eventsBeforeStatus := len(events)
	if _, err := GetRepoStatus(ctx, loc); err != nil {
		t.Fatalf("GetRepoStatus failed: %v", err)
	}
	if len(events) != eventsBeforeStatus {
		t.Fatalf("expected GetRepoStatus not to emit command events, got %+v", events[eventsBeforeStatus:])
	}

	// Stage + Commit should emit running/success pairs
	if err := os.WriteFile(filepath.Join(dir, "hello.txt"), []byte("hi\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := StageFile(ctx, loc, "hello.txt"); err != nil {
		t.Fatalf("StageFile failed: %v", err)
	}
	res, err := Commit(ctx, loc, "initial commit", "", false)
	if err != nil || !res.Success {
		t.Fatalf("Commit failed: %+v %v", res, err)
	}

	// Failing op should emit running -> error
	_, _ = CheckoutBranch(ctx, loc, "nonexistent-branch", false)

	var foundInit, foundAdd, foundCommit, foundCheckoutErr bool
	for _, ev := range events {
		if ev.Command == "git init" && ev.Status == "success" {
			foundInit = true
		}
		if ev.Command == "git add -- hello.txt" && ev.Status == "success" {
			foundAdd = true
		}
		if ev.Command == `git commit -m "initial commit"` && ev.Status == "success" {
			foundCommit = true
		}
		if ev.Command == "git checkout nonexistent-branch" && ev.Status == "error" && ev.Error != "" {
			foundCheckoutErr = true
		}
	}
	if !foundInit || !foundAdd || !foundCommit || !foundCheckoutErr {
		t.Fatalf("missing expected command events (init=%v add=%v commit=%v checkoutErr=%v); events=%+v",
			foundInit, foundAdd, foundCommit, foundCheckoutErr, events)
	}
}

func TestGetCommitHistoryLoadAllWithZeroLimit(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()

	loc, err := InitRepo(ctx, dir)
	if err != nil {
		t.Fatalf("InitRepo failed: %v", err)
	}
	_, _, _ = RunGit(ctx, loc, "config", "user.name", "Test User")
	_, _, _ = RunGit(ctx, loc, "config", "user.email", "test@example.com")

	for i := 1; i <= 5; i++ {
		name := fmt.Sprintf("f%d.txt", i)
		if err := os.WriteFile(filepath.Join(dir, name), []byte(name+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := StageAll(ctx, loc); err != nil {
			t.Fatal(err)
		}
		if res, err := Commit(ctx, loc, fmt.Sprintf("commit %d", i), "", false); err != nil || !res.Success {
			t.Fatalf("commit %d failed: %+v %v", i, res, err)
		}
	}

	all, err := GetCommitHistory(ctx, loc, "__ALL__", "", 0, 0)
	if err != nil {
		t.Fatalf("GetCommitHistory(limit=0) failed: %v", err)
	}
	if all.HasMore || len(all.Commits) != 5 {
		t.Fatalf("expected all 5 commits with HasMore=false, got len=%d hasMore=%v", len(all.Commits), all.HasMore)
	}

	paged, err := GetCommitHistory(ctx, loc, "__ALL__", "", 0, 2)
	if err != nil {
		t.Fatalf("GetCommitHistory(limit=2) failed: %v", err)
	}
	if !paged.HasMore || len(paged.Commits) != 2 {
		t.Fatalf("expected 2 commits with HasMore=true, got len=%d hasMore=%v", len(paged.Commits), paged.HasMore)
	}

	searched, err := GetCommitHistory(ctx, loc, "__ALL__", "commit 1", 0, 0)
	if err != nil {
		t.Fatalf("GetCommitHistory search failed: %v", err)
	}
	if searched.HasMore || len(searched.Commits) != 1 || searched.Commits[0].Subject != "commit 1" {
		t.Fatalf("expected 1 matching oldest commit, got %+v", searched)
	}
}

