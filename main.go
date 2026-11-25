package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
	"gitpulse/internal/git"
	"gitpulse/internal/store"
)

//go:embed all:frontend/dist
var assets embed.FS

func init() {
	application.RegisterEvent[git.CloneProgressEvent]("clone:progress")
}

func main() {
	st, err := store.NewStore()
	if err != nil {
		log.Fatal(err)
	}
	gitService := NewGitService(st)

	app := application.New(application.Options{
		Name:        "GitPulse",
		Description: "Lightweight Windows & WSL2 Git GUI Client",
		Services: []application.Service{
			application.NewService(gitService),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})
	gitService.SetApp(app)

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "GitPulse",
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
