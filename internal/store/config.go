package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"gitpulse/internal/git"
)

type LayoutState struct {
	SidebarWidth           float64 `json:"sidebarWidth,omitempty"`
	ChangesLeftRatio       float64 `json:"changesLeftRatio,omitempty"`
	ChangesUnstagedRatio   float64 `json:"changesUnstagedRatio,omitempty"`
	HistoryBottomRatio     float64 `json:"historyBottomRatio,omitempty"`
	HistoryDetailLeftRatio float64 `json:"historyDetailLeftRatio,omitempty"`
}

type AppSettings struct {
	AutoCheckUpdates    bool   `json:"autoCheckUpdates"`
	FontSize            int    `json:"fontSize"`
	DiffFontSize        int    `json:"diffFontSize"`
	AutoRefreshOnFocus  bool   `json:"autoRefreshOnFocus"`
	DefaultHistoryScope string `json:"defaultHistoryScope"`
	IgnoreWhitespace    bool   `json:"ignoreWhitespace"`
	GithubToken         string `json:"githubToken"`
}

func DefaultAppSettings() AppSettings {
	return AppSettings{
		AutoCheckUpdates:    true,
		FontSize:            13,
		DiffFontSize:        12,
		AutoRefreshOnFocus:  true,
		DefaultHistoryScope: "all",
	}
}

func normalizeAppSettings(in AppSettings) AppSettings {
	if in.FontSize < 11 {
		if in.FontSize == 0 {
			in.FontSize = 13
		} else {
			in.FontSize = 11
		}
	} else if in.FontSize > 18 {
		in.FontSize = 18
	}
	if in.DiffFontSize < 10 {
		if in.DiffFontSize == 0 {
			in.DiffFontSize = 12
		} else {
			in.DiffFontSize = 10
		}
	} else if in.DiffFontSize > 18 {
		in.DiffFontSize = 18
	}
	if in.DefaultHistoryScope != "branch" {
		in.DefaultHistoryScope = "all"
	}
	return in
}

type AppState struct {
	RecentRepos    []git.RecentRepo    `json:"recentRepos"`
	OpenTabs       []string            `json:"openTabs"`
	ActiveTab      string              `json:"activeTab"`
	PinnedBranches map[string][]string `json:"pinnedBranches,omitempty"`
	Layout         LayoutState         `json:"layout,omitempty"`
	Settings       *AppSettings        `json:"settings,omitempty"`
}

type Store struct {
	mu       sync.Mutex
	filePath string
	state    AppState
}

func NewStore() (*Store, error) {
	cfgDir, err := os.UserConfigDir()
	if err != nil {
		cfgDir = os.TempDir()
	}
	appDir := filepath.Join(cfgDir, "GitPulse")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		return nil, err
	}
	s := &Store{
		filePath: filepath.Join(appDir, "state.json"),
		state: AppState{
			RecentRepos:    []git.RecentRepo{},
			OpenTabs:       []string{},
			PinnedBranches: map[string][]string{},
		},
	}
	_ = s.load()
	return s, nil
}

func (s *Store) load() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := os.ReadFile(s.filePath)
	if err != nil {
		return err
	}
	var loaded AppState
	if err := json.Unmarshal(data, &loaded); err != nil {
		return err
	}
	if loaded.RecentRepos == nil {
		loaded.RecentRepos = []git.RecentRepo{}
	}
	if loaded.OpenTabs == nil {
		loaded.OpenTabs = []string{}
	}
	if loaded.PinnedBranches == nil {
		loaded.PinnedBranches = map[string][]string{}
	}
	s.state = loaded
	return nil
}

func (s *Store) saveLocked() error {
	data, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.filePath, data, 0o644)
}

func (s *Store) GetRecentRepos() []git.RecentRepo {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]git.RecentRepo, len(s.state.RecentRepos))
	copy(out, s.state.RecentRepos)
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Pinned != out[j].Pinned {
			return out[i].Pinned
		}
		return out[i].LastOpened > out[j].LastOpened
	})
	return out
}

func (s *Store) RecordOpenRepo(loc git.RepoLocation) []git.RecentRepo {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().Format(time.RFC3339)
	found := false
	for i := range s.state.RecentRepos {
		if s.state.RecentRepos[i].Path == loc.Path {
			s.state.RecentRepos[i].LastOpened = now
			s.state.RecentRepos[i].Name = loc.Name
			s.state.RecentRepos[i].IsWSL = loc.IsWSL
			s.state.RecentRepos[i].Distro = loc.Distro
			s.state.RecentRepos[i].LinuxPath = loc.LinuxPath
			found = true
			break
		}
	}
	if !found {
		s.state.RecentRepos = append(s.state.RecentRepos, git.RecentRepo{
			Path:       loc.Path,
			Name:       loc.Name,
			IsWSL:      loc.IsWSL,
			Distro:     loc.Distro,
			LinuxPath:  loc.LinuxPath,
			LastOpened: now,
		})
	}
	if len(s.state.RecentRepos) > 30 {
		// Keep pinned + newest
		var kept []git.RecentRepo
		for _, r := range s.state.RecentRepos {
			if r.Pinned || len(kept) < 30 {
				kept = append(kept, r)
			}
		}
		s.state.RecentRepos = kept
	}
	_ = s.saveLocked()
	return s.getSortedLocked()
}

func (s *Store) TogglePinRepo(repoPath string) []git.RecentRepo {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.state.RecentRepos {
		if s.state.RecentRepos[i].Path == repoPath {
			s.state.RecentRepos[i].Pinned = !s.state.RecentRepos[i].Pinned
			break
		}
	}
	_ = s.saveLocked()
	return s.getSortedLocked()
}

func (s *Store) RemoveRecentRepo(repoPath string) []git.RecentRepo {
	s.mu.Lock()
	defer s.mu.Unlock()
	filtered := make([]git.RecentRepo, 0, len(s.state.RecentRepos))
	for _, r := range s.state.RecentRepos {
		if r.Path != repoPath {
			filtered = append(filtered, r)
		}
	}
	s.state.RecentRepos = filtered
	_ = s.saveLocked()
	return s.getSortedLocked()
}

func (s *Store) SaveOpenTabs(tabs []string, active string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.OpenTabs = tabs
	s.state.ActiveTab = active
	_ = s.saveLocked()
}

func (s *Store) GetOpenTabs() ([]string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	tabs := make([]string, len(s.state.OpenTabs))
	copy(tabs, s.state.OpenTabs)
	return tabs, s.state.ActiveTab
}

func (s *Store) getSortedLocked() []git.RecentRepo {
	out := make([]git.RecentRepo, len(s.state.RecentRepos))
	copy(out, s.state.RecentRepos)
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Pinned != out[j].Pinned {
			return out[i].Pinned
		}
		return out[i].LastOpened > out[j].LastOpened
	})
	return out
}

func (s *Store) GetPinnedBranches(repoPath string) []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := s.state.PinnedBranches[repoPath]
	out := make([]string, len(list))
	copy(out, list)
	return out
}

func (s *Store) TogglePinBranch(repoPath, fullName string) []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.PinnedBranches == nil {
		s.state.PinnedBranches = map[string][]string{}
	}
	cur := s.state.PinnedBranches[repoPath]
	next := make([]string, 0, len(cur)+1)
	found := false
	for _, b := range cur {
		if b == fullName {
			found = true
			continue
		}
		next = append(next, b)
	}
	if !found && fullName != "" {
		next = append(next, fullName)
	}
	if len(next) == 0 {
		delete(s.state.PinnedBranches, repoPath)
	} else {
		s.state.PinnedBranches[repoPath] = next
	}
	_ = s.saveLocked()
	out := make([]string, len(next))
	copy(out, next)
	return out
}

func (s *Store) RenamePinnedBranch(repoPath, oldFullName, newFullName string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur := s.state.PinnedBranches[repoPath]
	changed := false
	for i, b := range cur {
		if b == oldFullName {
			cur[i] = newFullName
			changed = true
		}
	}
	if changed {
		s.state.PinnedBranches[repoPath] = cur
		_ = s.saveLocked()
	}
}

func (s *Store) RemovePinnedBranch(repoPath, fullName string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur := s.state.PinnedBranches[repoPath]
	if len(cur) == 0 {
		return
	}
	next := make([]string, 0, len(cur))
	changed := false
	for _, b := range cur {
		if b == fullName {
			changed = true
			continue
		}
		next = append(next, b)
	}
	if changed {
		if len(next) == 0 {
			delete(s.state.PinnedBranches, repoPath)
		} else {
			s.state.PinnedBranches[repoPath] = next
		}
		_ = s.saveLocked()
	}
}

func (s *Store) GetLayoutState() LayoutState {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state.Layout
}

func (s *Store) SaveLayoutState(layout LayoutState) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.Layout = layout
	_ = s.saveLocked()
}

func (s *Store) GetAppSettings() AppSettings {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Settings == nil {
		return DefaultAppSettings()
	}
	return normalizeAppSettings(*s.state.Settings)
}

func (s *Store) SaveAppSettings(settings AppSettings) AppSettings {
	s.mu.Lock()
	defer s.mu.Unlock()
	norm := normalizeAppSettings(settings)
	s.state.Settings = &norm
	_ = s.saveLocked()
	return norm
}
