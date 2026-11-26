package store

import (
	"path/filepath"
	"testing"
)

func TestPinnedBranchesPersistence(t *testing.T) {
	dir := t.TempDir()
	st := &Store{
		filePath: filepath.Join(dir, "state.json"),
		state: AppState{
			PinnedBranches: map[string][]string{},
		},
	}

	repo := `D:\code\repo`
	if got := st.TogglePinBranch(repo, "refs/heads/feat"); len(got) != 1 || got[0] != "refs/heads/feat" {
		t.Fatalf("unexpected pinned list after add: %v", got)
	}
	st.RenamePinnedBranch(repo, "refs/heads/feat", "refs/heads/feat-v2")
	if got := st.GetPinnedBranches(repo); len(got) != 1 || got[0] != "refs/heads/feat-v2" {
		t.Fatalf("unexpected pinned list after rename: %v", got)
	}

	// Reload from disk
	reloaded := &Store{filePath: st.filePath}
	if err := reloaded.load(); err != nil {
		t.Fatalf("load failed: %v", err)
	}
	if got := reloaded.GetPinnedBranches(repo); len(got) != 1 || got[0] != "refs/heads/feat-v2" {
		t.Fatalf("unexpected reloaded pinned list: %v", got)
	}

	reloaded.RemovePinnedBranch(repo, "refs/heads/feat-v2")
	if got := reloaded.GetPinnedBranches(repo); len(got) != 0 {
		t.Fatalf("expected empty pinned list after remove, got: %v", got)
	}
}

func TestLayoutStatePersistence(t *testing.T) {
	dir := t.TempDir()
	st := &Store{
		filePath: filepath.Join(dir, "state.json"),
		state: AppState{
			PinnedBranches: map[string][]string{},
		},
	}

	want := LayoutState{
		SidebarWidth:           310,
		ChangesLeftRatio:       0.38,
		ChangesUnstagedRatio:   0.62,
		HistoryBottomRatio:     0.52,
		HistoryDetailLeftRatio: 0.35,
	}
	st.SaveLayoutState(want)

	reloaded := &Store{filePath: st.filePath}
	if err := reloaded.load(); err != nil {
		t.Fatalf("load failed: %v", err)
	}
	got := reloaded.GetLayoutState()
	if got != want {
		t.Fatalf("layout mismatch: got %+v, want %+v", got, want)
	}
}
