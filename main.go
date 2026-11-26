package main

import (
	"embed"
	"log"
	"strings"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"gitpulse/internal/git"
	"gitpulse/internal/store"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var trayIcon []byte

func init() {
	application.RegisterEvent[git.CloneProgressEvent]("clone:progress")
	application.RegisterEvent[UpdateStatus]("update:status")
	application.RegisterEvent[string]("app:open-repo")
}

func main() {
	st, err := store.NewStore()
	if err != nil {
		log.Fatal(err)
	}
	gitService := NewGitService(st)
	updateService := NewUpdateService(AppVersion, githubRepoSlug)

	var app *application.App
	var mainWin *application.WebviewWindow
	var allowQuit atomic.Bool

	showMainWindow := func() {
		if mainWin == nil {
			return
		}
		if mainWin.IsMinimised() {
			mainWin.UnMinimise()
		}
		mainWin.Show()
		mainWin.Focus()
	}

	updateService.setQuitCallback(func(allow bool) {
		allowQuit.Store(allow)
	})

	app = application.New(application.Options{
		Name:        "mygit",
		Description: "Lightweight Windows & WSL2 Git GUI Client",
		Services: []application.Service{
			application.NewService(gitService),
			application.NewService(updateService),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "com.overstar.mygit",
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				showMainWindow()
				if app != nil && len(data.Args) > 0 {
					candidate := strings.TrimSpace(data.Args[0])
					if candidate != "" {
						app.Event.Emit("app:open-repo", candidate)
					}
				}
			},
		},
		Windows: application.WindowsOptions{
			DisableQuitOnLastWindowClosed: true,
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
	})
	gitService.SetApp(app)
	if err := updateService.AttachApp(app); err != nil {
		log.Printf("updater init warning: %v", err)
	}

	mainWin = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "mygit",
		Width:     1380,
		Height:    860,
		MinWidth:  1024,
		MinHeight: 640,
		Frameless: true,
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 36,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		BackgroundColour: application.NewRGB(248, 249, 255),
		URL:              "/",
	})

	mainWin.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if allowQuit.Load() {
			return
		}
		event.Cancel()
		mainWin.Hide()
	})

	tray := app.SystemTray.New()
	tray.SetIcon(trayIcon)
	tray.SetTooltip("mygit")
	trayMenu := application.NewMenu()
	trayMenu.Add("显示主窗口").OnClick(func(_ *application.Context) {
		showMainWindow()
	})
	trayMenu.AddSeparator()
	trayMenu.Add("退出 mygit").OnClick(func(_ *application.Context) {
		allowQuit.Store(true)
		app.Quit()
	})
	tray.SetMenu(trayMenu)
	tray.OnClick(func() {
		showMainWindow()
	})
	tray.OnDoubleClick(func() {
		showMainWindow()
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
