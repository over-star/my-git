package git

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
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
	tags, err := ListTags(ctx, loc)
	if err != nil || len(tags) != 1 || tags[0].Name != "v1.0.0" {
		t.Fatalf("ListTags unexpected: %+v err=%v", tags, err)
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

