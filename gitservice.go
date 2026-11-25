package main

import (
	"context"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"gitpulse/internal/git"
	"gitpulse/internal/store"
)

type GitService struct {
	app   *application.App
	store *store.Store
}

func NewGitService(st *store.Store) *GitService {
	return &GitService{store: st}
}

func (s *GitService) SetApp(app *application.App) {
	s.app = app
}

func (s *GitService) ctx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 30*time.Second)
}

func (s *GitService) longCtx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 10*time.Minute)
}

// --- Dialogs & App State ---

func (s *GitService) PickFolder(title string) (string, error) {
	if s.app == nil {
		return "", nil
	}
	if title == "" {
		title = "Select Folder"
	}
	d := s.app.Dialog.OpenFile().
		SetTitle(title).
		CanChooseDirectories(true).
		CanChooseFiles(false).
		CanCreateDirectories(true)
	if win := s.app.Window.Current(); win != nil {
		d.AttachToWindow(win)
	}
	return d.PromptForSingleSelection()
}

func (s *GitService) GetRecentRepos() []git.RecentRepo {
	return s.store.GetRecentRepos()
}

func (s *GitService) TogglePinRepo(repoPath string) []git.RecentRepo {
	return s.store.TogglePinRepo(repoPath)
}

func (s *GitService) RemoveRecentRepo(repoPath string) []git.RecentRepo {
	return s.store.RemoveRecentRepo(repoPath)
}

func (s *GitService) SaveOpenTabs(tabs []string, active string) {
	s.store.SaveOpenTabs(tabs, active)
}

type SavedTabsState struct {
	Tabs      []string `json:"tabs"`
	ActiveTab string   `json:"activeTab"`
}

func (s *GitService) GetSavedTabs() SavedTabsState {
	tabs, active := s.store.GetOpenTabs()
	return SavedTabsState{Tabs: tabs, ActiveTab: active}
}

// --- WSL2 Discovery & Browsing ---

func (s *GitService) ListWSLDistros() ([]git.WSLDistro, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.ListWSLDistros(ctx)
}

type WSLBrowseResult struct {
	Path    string         `json:"path"`
	Entries []git.WSLEntry `json:"entries"`
}

func (s *GitService) BrowseWSLDir(distro, linuxPath string) (WSLBrowseResult, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	entries, resolved, err := git.BrowseWSLDir(ctx, distro, linuxPath)
	return WSLBrowseResult{Path: resolved, Entries: entries}, err
}

// --- Repository Lifecycle ---

func (s *GitService) OpenRepo(rawPath string) (git.RepoLocation, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	loc, err := git.ValidateGitRepo(ctx, rawPath)
	if err != nil {
		return loc, err
	}
	s.store.RecordOpenRepo(loc)
	return loc, nil
}

func (s *GitService) InitRepo(rawPath string) (git.RepoLocation, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	loc, err := git.InitRepo(ctx, rawPath)
	if err != nil {
		return loc, err
	}
	s.store.RecordOpenRepo(loc)
	return loc, nil
}

func (s *GitService) CloneRepo(cloneID, repoURL, targetParent, folderName string) (git.RepoLocation, error) {
	ctx, cancel := s.longCtx()
	defer cancel()
	loc, err := git.CloneRepo(ctx, cloneID, repoURL, targetParent, folderName, func(ev git.CloneProgressEvent) {
		if s.app != nil {
			s.app.Event.Emit("clone:progress", ev)
		}
	})
	if err != nil {
		return loc, err
	}
	s.store.RecordOpenRepo(loc)
	return loc, nil
}

// --- Status, Staging & Diff ---

func (s *GitService) GetStatus(repoPath string) (git.RepoStatus, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	loc := git.ParseRepoLocation(repoPath)
	return git.GetRepoStatus(ctx, loc)
}

func (s *GitService) StageFile(repoPath, relPath string) error {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.StageFile(ctx, git.ParseRepoLocation(repoPath), relPath)
}

func (s *GitService) UnstageFile(repoPath, relPath string) error {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.UnstageFile(ctx, git.ParseRepoLocation(repoPath), relPath)
}

func (s *GitService) StageAll(repoPath string) error {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.StageAll(ctx, git.ParseRepoLocation(repoPath))
}

func (s *GitService) UnstageAll(repoPath string) error {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.UnstageAll(ctx, git.ParseRepoLocation(repoPath))
}

func (s *GitService) DiscardFile(repoPath, relPath string, isUntracked bool) error {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.DiscardFile(ctx, git.ParseRepoLocation(repoPath), relPath, isUntracked)
}

func (s *GitService) GetWorkingDiff(repoPath, relPath string, staged, isUntracked, ignoreWhitespace bool) (git.FileDiff, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.GetWorkingDiff(ctx, git.ParseRepoLocation(repoPath), relPath, staged, isUntracked, ignoreWhitespace)
}

// --- Commits & History ---

func (s *GitService) Commit(repoPath, summary, description string, amend bool) (git.OpResult, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.Commit(ctx, git.ParseRepoLocation(repoPath), summary, description, amend)
}

type LastCommitMessage struct {
	Summary     string `json:"summary"`
	Description string `json:"description"`
}

func (s *GitService) GetLastCommitMessage(repoPath string) (LastCommitMessage, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	sum, desc, err := git.GetLastCommitMessage(ctx, git.ParseRepoLocation(repoPath))
	return LastCommitMessage{Summary: sum, Description: desc}, err
}

func (s *GitService) GetCommitHistory(repoPath, branch, search string, skip, limit int) (git.CommitPage, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.GetCommitHistory(ctx, git.ParseRepoLocation(repoPath), branch, search, skip, limit)
}

func (s *GitService) GetCommitDetail(repoPath, hash string) (git.CommitDetail, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.GetCommitDetail(ctx, git.ParseRepoLocation(repoPath), hash)
}

func (s *GitService) GetCommitFileDiff(repoPath, hash, relPath string, ignoreWhitespace bool) (git.FileDiff, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.GetCommitFileDiff(ctx, git.ParseRepoLocation(repoPath), hash, relPath, ignoreWhitespace)
}

// --- Branches, Tags & Stashes ---

func (s *GitService) ListBranches(repoPath string) ([]git.BranchInfo, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.ListBranches(ctx, git.ParseRepoLocation(repoPath))
}

func (s *GitService) CheckoutBranch(repoPath, branchName string, isRemote bool) (git.OpResult, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.CheckoutBranch(ctx, git.ParseRepoLocation(repoPath), branchName, isRemote)
}

func (s *GitService) CreateBranch(repoPath, name, startPoint string, checkout bool) (git.OpResult, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.CreateBranch(ctx, git.ParseRepoLocation(repoPath), name, startPoint, checkout)
}

func (s *GitService) MergeBranch(repoPath, branchName string) (git.OpResult, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.MergeBranch(ctx, git.ParseRepoLocation(repoPath), branchName)
}

func (s *GitService) DeleteBranch(repoPath, name string, force bool) (git.OpResult, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.DeleteBranch(ctx, git.ParseRepoLocation(repoPath), name, force)
}

func (s *GitService) RenameBranch(repoPath, oldName, newName string) (git.OpResult, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.RenameBranch(ctx, git.ParseRepoLocation(repoPath), oldName, newName)
}

func (s *GitService) DeleteRemoteBranch(repoPath, remoteBranch string) (git.OpResult, error) {
	ctx, cancel := s.longCtx()
	defer cancel()
	return git.DeleteRemoteBranch(ctx, git.ParseRepoLocation(repoPath), remoteBranch)
}

func (s *GitService) ListTags(repoPath string) ([]git.TagInfo, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.ListTags(ctx, git.ParseRepoLocation(repoPath))
}

func (s *GitService) CreateTag(repoPath, name, target, message string) (git.OpResult, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.CreateTag(ctx, git.ParseRepoLocation(repoPath), name, target, message)
}

func (s *GitService) ListStashes(repoPath string) ([]git.StashItem, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.ListStashes(ctx, git.ParseRepoLocation(repoPath))
}

func (s *GitService) StashPush(repoPath, message string, includeUntracked bool) (git.OpResult, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.StashPush(ctx, git.ParseRepoLocation(repoPath), message, includeUntracked)
}

func (s *GitService) StashApply(repoPath, ref string) (git.OpResult, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.StashApply(ctx, git.ParseRepoLocation(repoPath), ref)
}

func (s *GitService) StashPop(repoPath, ref string) (git.OpResult, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.StashPop(ctx, git.ParseRepoLocation(repoPath), ref)
}

func (s *GitService) StashDrop(repoPath, ref string) (git.OpResult, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.StashDrop(ctx, git.ParseRepoLocation(repoPath), ref)
}

// --- Remote Sync & Conflict Resolution ---

func (s *GitService) Fetch(repoPath string) (git.OpResult, error) {
	ctx, cancel := s.longCtx()
	defer cancel()
	return git.Fetch(ctx, git.ParseRepoLocation(repoPath))
}

func (s *GitService) Pull(repoPath string) (git.OpResult, error) {
	ctx, cancel := s.longCtx()
	defer cancel()
	return git.Pull(ctx, git.ParseRepoLocation(repoPath))
}

func (s *GitService) Push(repoPath string) (git.OpResult, error) {
	ctx, cancel := s.longCtx()
	defer cancel()
	return git.Push(ctx, git.ParseRepoLocation(repoPath))
}

func (s *GitService) GetConflictFile(repoPath, relPath string) (git.ConflictFileContent, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.GetConflictFile(ctx, git.ParseRepoLocation(repoPath), relPath)
}

func (s *GitService) SaveResolvedConflict(repoPath, relPath, content string, markResolved bool) error {
	ctx, cancel := s.ctx()
	defer cancel()
	loc := git.ParseRepoLocation(repoPath)
	if err := git.WriteRepoFile(ctx, loc, relPath, content); err != nil {
		return err
	}
	if markResolved {
		return git.StageFile(ctx, loc, relPath)
	}
	return nil
}

func (s *GitService) AbortMerge(repoPath string) (git.OpResult, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.AbortMerge(ctx, git.ParseRepoLocation(repoPath))
}

// --- OS Integration ---

func (s *GitService) OpenInExplorer(repoPath, relPath string) error {
	return git.OpenInExplorer(git.ParseRepoLocation(repoPath), relPath)
}

func (s *GitService) OpenInTerminal(repoPath string) error {
	return git.OpenInTerminal(git.ParseRepoLocation(repoPath))
}

func (s *GitService) OpenInEditor(repoPath, relPath string) error {
	return git.OpenInEditor(git.ParseRepoLocation(repoPath), relPath)
}

// --- Window Controls ---

func (s *GitService) MinimizeWindow() {
	if s.app != nil {
		if w := s.app.Window.Current(); w != nil {
			w.Minimise()
		}
	}
}

func (s *GitService) ToggleMaximizeWindow() {
	if s.app != nil {
		if w := s.app.Window.Current(); w != nil {
			w.ToggleMaximise()
		}
	}
}

func (s *GitService) CloseWindow() {
	if s.app != nil {
		if w := s.app.Window.Current(); w != nil {
			w.Close()
		}
	}
}

func (s *GitService) GetGitGlobalVersion() string {
	ctx, cancel := s.ctx()
	defer cancel()
	out, _, err := git.RunGitInDir(ctx, git.RepoLocation{}, "--version")
	if err != nil {
		return "git unavailable"
	}
	return strings.TrimPrefix(strings.TrimSpace(out), "git version ")
}

func (s *GitService) GetGitConfig(repoPath, distroOverride string) (git.GitConfigBundle, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.GetGitConfig(ctx, repoPath, distroOverride)
}

func (s *GitService) SaveGitConfig(upd git.GitConfigUpdate) (git.OpResult, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	return git.SaveGitConfig(ctx, upd)
}
