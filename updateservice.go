package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
	ghprovider "github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

// AppVersion is the current semantic version (without leading "v").
// Can be overridden at build time via -ldflags "-X main.AppVersion=x.y.z".
var AppVersion = "0.1.2"

const (
	githubRepoSlug = "over-star/my-git"
	githubRepoURL  = "https://github.com/" + githubRepoSlug
	releasesURL    = githubRepoURL + "/releases"
)

type UpdateReleaseInfo struct {
	Version     string `json:"version"`
	Name        string `json:"name"`
	Notes       string `json:"notes"`
	PublishedAt string `json:"publishedAt"`
	AssetName   string `json:"assetName"`
	AssetSize   int64  `json:"assetSize"`
	ReleaseURL  string `json:"releaseUrl"`
}

type UpdateStatus struct {
	State           string             `json:"state"`
	CurrentVersion  string             `json:"currentVersion"`
	Available       *UpdateReleaseInfo `json:"available,omitempty"`
	DownloadedBytes int64              `json:"downloadedBytes"`
	TotalBytes      int64              `json:"totalBytes"`
	Percent         int                `json:"percent"`
	ErrorMessage    string             `json:"errorMessage,omitempty"`
	CanSelfUpdate   bool               `json:"canSelfUpdate"`
	RepoURL         string             `json:"repoUrl"`
	ReleasesURL     string             `json:"releasesUrl"`
}

type UpdateService struct {
	app          *application.App
	repo         string
	setAllowQuit func(bool)

	mu     sync.RWMutex
	status UpdateStatus
}

func (s *UpdateService) setQuitCallback(fn func(bool)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.setAllowQuit = fn
}

func NewUpdateService(currentVersion, repo string) *UpdateService {
	v := strings.TrimPrefix(strings.TrimSpace(currentVersion), "v")
	if v == "" {
		v = "0.1.0"
	}
	return &UpdateService{
		repo: repo,
		status: UpdateStatus{
			State:          "idle",
			CurrentVersion: v,
			CanSelfUpdate:  canWriteExeDir(),
			RepoURL:        githubRepoURL,
			ReleasesURL:    releasesURL,
		},
	}
}

func (s *UpdateService) AttachApp(app *application.App) error {
	s.app = app
	if app == nil || app.Updater == nil {
		return errors.New("updater is not available")
	}

	provider, err := ghprovider.New(ghprovider.Config{
		Repository:    s.repo,
		ChecksumAsset: "checksums.txt",
	})
	if err != nil {
		return err
	}

	if err := app.Updater.Init(updater.Config{
		CurrentVersion: s.status.CurrentVersion,
		Providers:      []updater.Provider{provider},
		Window:         updater.WindowNone,
	}); err != nil && !errors.Is(err, updater.ErrAlreadyConfigured) {
		return err
	}

	s.subscribeEvents(app)
	return nil
}

func (s *UpdateService) subscribeEvents(app *application.App) {
	app.Event.On(updater.EventDownloadProgress, func(e *application.CustomEvent) {
		p, ok := extractProgress(e)
		if !ok {
			return
		}
		pct := 0
		if p.Total > 0 {
			pct = int((p.Written * 100) / p.Total)
			if pct > 100 {
				pct = 100
			}
		}
		s.updateAndEmit(func(st *UpdateStatus) {
			st.State = "downloading"
			st.DownloadedBytes = p.Written
			if p.Total > 0 {
				st.TotalBytes = p.Total
			}
			st.Percent = pct
			st.ErrorMessage = ""
		})
	})

	app.Event.On(updater.EventVerifying, func(_ *application.CustomEvent) {
		s.updateAndEmit(func(st *UpdateStatus) {
			st.State = "verifying"
			st.Percent = 100
		})
	})

	app.Event.On(updater.EventInstalling, func(_ *application.CustomEvent) {
		s.updateAndEmit(func(st *UpdateStatus) {
			st.State = "installing"
			st.Percent = 100
		})
	})

	app.Event.On(updater.EventUpdateReady, func(_ *application.CustomEvent) {
		s.updateAndEmit(func(st *UpdateStatus) {
			st.State = "ready"
			st.Percent = 100
			st.ErrorMessage = ""
		})
	})

	app.Event.On(updater.EventError, func(e *application.CustomEvent) {
		info, ok := extractErrorInfo(e)
		msg := "Update failed"
		if ok && strings.TrimSpace(info.Message) != "" {
			msg = info.Message
		}
		s.updateAndEmit(func(st *UpdateStatus) {
			st.State = "error"
			st.ErrorMessage = msg
		})
	})
}

func (s *UpdateService) GetAppVersion() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.status.CurrentVersion
}

func (s *UpdateService) GetUpdateStatus() UpdateStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.status
}

func (s *UpdateService) CheckForUpdate() UpdateStatus {
	if s.app == nil || s.app.Updater == nil {
		return s.setError("Updater is not initialized")
	}

	s.mu.RLock()
	curState := s.status.State
	s.mu.RUnlock()
	if curState == "downloading" || curState == "verifying" || curState == "installing" || curState == "ready" {
		return s.GetUpdateStatus()
	}

	s.updateAndEmit(func(st *UpdateStatus) {
		st.State = "checking"
		st.ErrorMessage = ""
		st.CanSelfUpdate = canWriteExeDir()
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	rel, err := s.app.Updater.Check(ctx)
	if err != nil {
		return s.setError(err.Error())
	}
	if rel == nil {
		return s.updateAndEmit(func(st *UpdateStatus) {
			st.State = "up-to-date"
			st.Available = nil
			st.ErrorMessage = ""
			st.DownloadedBytes = 0
			st.TotalBytes = 0
			st.Percent = 0
		})
	}

	info := releaseToInfo(rel)
	return s.updateAndEmit(func(st *UpdateStatus) {
		st.State = "available"
		st.Available = &info
		st.TotalBytes = info.AssetSize
		st.DownloadedBytes = 0
		st.Percent = 0
		st.ErrorMessage = ""
	})
}

func (s *UpdateService) DownloadAndInstall() UpdateStatus {
	if s.app == nil || s.app.Updater == nil {
		return s.setError("Updater is not initialized")
	}
	if !canWriteExeDir() {
		return s.setError("Install directory is not writable. Please download the installer from GitHub Releases or run as administrator.")
	}

	s.mu.RLock()
	curState := s.status.State
	avail := s.status.Available
	s.mu.RUnlock()

	if curState == "ready" {
		return s.GetUpdateStatus()
	}
	if avail == nil {
		checked := s.CheckForUpdate()
		if checked.Available == nil {
			return checked
		}
	}

	s.updateAndEmit(func(st *UpdateStatus) {
		st.State = "downloading"
		st.DownloadedBytes = 0
		st.Percent = 0
		st.ErrorMessage = ""
	})

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	if err := s.app.Updater.DownloadAndInstall(ctx); err != nil {
		return s.setError(err.Error())
	}

	return s.updateAndEmit(func(st *UpdateStatus) {
		st.State = "ready"
		st.Percent = 100
		st.ErrorMessage = ""
	})
}

func (s *UpdateService) RestartAndApply() error {
	if s.app == nil || s.app.Updater == nil {
		return errors.New("updater is not initialized")
	}
	s.mu.RLock()
	setQuit := s.setAllowQuit
	s.mu.RUnlock()
	if setQuit != nil {
		setQuit(true)
	}
	if err := s.app.Updater.Restart(context.Background()); err != nil {
		if setQuit != nil {
			setQuit(false)
		}
		return err
	}
	return nil
}

func (s *UpdateService) OpenReleasePage(urlStr string) error {
	if s.app == nil {
		return errors.New("application is not initialized")
	}
	target := strings.TrimSpace(urlStr)
	if target == "" || (!strings.HasPrefix(target, "https://github.com/") && !strings.HasPrefix(target, "http://github.com/")) {
		target = releasesURL
	}
	return s.app.Browser.OpenURL(target)
}

func (s *UpdateService) setError(msg string) UpdateStatus {
	return s.updateAndEmit(func(st *UpdateStatus) {
		st.State = "error"
		st.ErrorMessage = msg
	})
}

func (s *UpdateService) updateAndEmit(fn func(*UpdateStatus)) UpdateStatus {
	s.mu.Lock()
	fn(&s.status)
	snapshot := s.status
	s.mu.Unlock()

	if s.app != nil {
		s.app.Event.Emit("update:status", snapshot)
	}
	return snapshot
}

func releaseToInfo(rel *updater.Release) UpdateReleaseInfo {
	relURL := releasesURL
	if rel.Metadata != nil {
		if u, ok := rel.Metadata["github.release.htmlURL"].(string); ok && strings.TrimSpace(u) != "" {
			relURL = u
		}
	}
	pub := ""
	if !rel.PublishedAt.IsZero() {
		pub = rel.PublishedAt.Local().Format("2006-01-02 15:04")
	}
	name := strings.TrimSpace(rel.Name)
	if name == "" {
		name = "v" + rel.Version
	}
	return UpdateReleaseInfo{
		Version:     rel.Version,
		Name:        name,
		Notes:       strings.TrimSpace(rel.Notes),
		PublishedAt: pub,
		AssetName:   rel.Artifact.Filename,
		AssetSize:   rel.Artifact.Size,
		ReleaseURL:  relURL,
	}
}

func extractProgress(e *application.CustomEvent) (updater.Progress, bool) {
	if e == nil {
		return updater.Progress{}, false
	}
	if p, ok := e.Data.(updater.Progress); ok {
		return p, true
	}
	if p, ok := e.Data.(*updater.Progress); ok && p != nil {
		return *p, true
	}
	var p updater.Progress
	if err := json.Unmarshal([]byte(e.ToJSON()), &p); err == nil {
		return p, true
	}
	return updater.Progress{}, false
}

func extractErrorInfo(e *application.CustomEvent) (updater.ErrorInfo, bool) {
	if e == nil {
		return updater.ErrorInfo{}, false
	}
	if info, ok := e.Data.(updater.ErrorInfo); ok {
		return info, true
	}
	if info, ok := e.Data.(*updater.ErrorInfo); ok && info != nil {
		return *info, true
	}
	var info updater.ErrorInfo
	if err := json.Unmarshal([]byte(e.ToJSON()), &info); err == nil {
		return info, true
	}
	return updater.ErrorInfo{}, false
}

func canWriteExeDir() bool {
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	dir := filepath.Dir(exe)
	f, err := os.CreateTemp(dir, ".mygit-write-probe-*")
	if err != nil {
		return false
	}
	name := f.Name()
	_ = f.Close()
	_ = os.Remove(name)
	return true
}
