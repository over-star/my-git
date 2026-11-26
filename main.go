package main

import (
	"embed"
	"log"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"gitpulse/internal/git"
	"gitpulse/internal/store"
)

//go:embed all:frontend/dist
var assets embed.FS

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
				if mainWin != nil {
					if mainWin.IsMinimised() {
						mainWin.UnMinimise()
					}
					mainWin.Show()
					mainWin.Focus()
				}
				if app != nil && len(data.Args) > 0 {
					candidate := strings.TrimSpace(data.Args[0])
					if candidate != "" {
						app.Event.Emit("app:open-repo", candidate)
					}
				}
			},
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
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

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
