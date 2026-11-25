package git

import (
	"context"
	"fmt"
	"strings"
)

// GetGitConfig reads local (if repoPath given), global, and effective Git configuration.
// If distroOverride is provided for global config, global config is read from that WSL2 distro.
// Otherwise, if repoPath points to a WSL2 repo, global config is also read from that WSL2 distro.
func GetGitConfig(ctx context.Context, repoPath, distroOverride string) (GitConfigBundle, error) {
	bundle := GitConfigBundle{}
	var loc RepoLocation
	if strings.TrimSpace(repoPath) != "" {
		loc = ParseRepoLocation(repoPath)
		bundle.RepoName = loc.Name
		bundle.RepoPath = loc.Path
		bundle.IsWSL = loc.IsWSL
		bundle.Distro = loc.Distro
	}

	globalLoc := RepoLocation{}
	if strings.TrimSpace(distroOverride) != "" {
		globalLoc = RepoLocation{IsWSL: true, Distro: strings.TrimSpace(distroOverride)}
	} else if loc.IsWSL {
		globalLoc = RepoLocation{IsWSL: true, Distro: loc.Distro}
	}

	if globalLoc.IsWSL {
		bundle.ScopeEnvLabel = fmt.Sprintf("WSL2 (%s)", globalLoc.Distro)
	} else {
		bundle.ScopeEnvLabel = "Windows Local"
	}

	bundle.Global = readConfigScope(ctx, globalLoc, "--global", true)

	if loc.Path != "" {
		bundle.Local = readConfigScope(ctx, loc, "--local", false)
		bundle.Effective = readConfigScope(ctx, loc, "", false)
	} else {
		bundle.Effective = bundle.Global
	}

	return bundle, nil
}

func readConfigScope(ctx context.Context, loc RepoLocation, scopeFlag string, skipCD bool) GitIdentity {
	args := []string{"config"}
	if scopeFlag != "" {
		args = append(args, scopeFlag)
	}
	args = append(args, "--list")

	var out string
	var err error
	if skipCD {
		out, _, err = RunGitInDir(ctx, loc, args...)
	} else {
		out, _, err = RunGit(ctx, loc, args...)
	}
	if err != nil || out == "" {
		return GitIdentity{}
	}

	var id GitIdentity
	for _, line := range strings.Split(strings.ReplaceAll(out, "\r\n", "\n"), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		kv := strings.SplitN(line, "=", 2)
		if len(kv) != 2 {
			continue
		}
		k := strings.ToLower(strings.TrimSpace(kv[0]))
		v := strings.TrimSpace(kv[1])
		switch k {
		case "user.name":
			id.UserName = v
		case "user.email":
			id.UserEmail = v
		case "init.defaultbranch":
			id.DefaultBranch = v
		case "core.autocrlf":
			id.AutoCRLF = v
		case "pull.rebase":
			id.PullRebase = v
		case "commit.gpgsign":
			id.GPGSign = v
		case "user.signingkey":
			id.SigningKey = v
		}
	}
	return id
}

// SaveGitConfig writes Git configuration keys to either --local (for a repo) or --global (Windows or WSL2).
func SaveGitConfig(ctx context.Context, upd GitConfigUpdate) (OpResult, error) {
	isLocal := upd.Scope == "local"
	var loc RepoLocation
	skipCD := false
	scopeFlag := "--global"

	if isLocal {
		if strings.TrimSpace(upd.RepoPath) == "" {
			return OpResult{Success: false, Message: "No repository open for local config"}, nil
		}
		loc = ParseRepoLocation(upd.RepoPath)
		scopeFlag = "--local"
	} else {
		skipCD = true
		if strings.TrimSpace(upd.Distro) != "" {
			loc = RepoLocation{IsWSL: true, Distro: strings.TrimSpace(upd.Distro)}
		} else if strings.TrimSpace(upd.RepoPath) != "" {
			parsed := ParseRepoLocation(upd.RepoPath)
			if parsed.IsWSL {
				loc = RepoLocation{IsWSL: true, Distro: parsed.Distro}
			}
		}
	}

	pairs := []struct {
		key string
		val string
	}{
		{"user.name", strings.TrimSpace(upd.UserName)},
		{"user.email", strings.TrimSpace(upd.UserEmail)},
		{"core.autocrlf", strings.TrimSpace(upd.AutoCRLF)},
		{"pull.rebase", strings.TrimSpace(upd.PullRebase)},
		{"commit.gpgsign", strings.TrimSpace(upd.GPGSign)},
		{"user.signingkey", strings.TrimSpace(upd.SigningKey)},
	}
	if !isLocal {
		pairs = append(pairs, struct {
			key string
			val string
		}{"init.defaultBranch", strings.TrimSpace(upd.DefaultBranch)})
	}

	for _, p := range pairs {
		var args []string
		if p.val == "" {
			args = []string{"config", scopeFlag, "--unset-all", p.key}
		} else {
			args = []string{"config", scopeFlag, p.key, p.val}
		}

		var stdout, stderr string
		var err error
		if skipCD {
			stdout, stderr, err = RunGitInDir(ctx, loc, args...)
		} else {
			stdout, stderr, err = RunGit(ctx, loc, args...)
		}
		if err != nil {
			// git config --unset-all returns exit code 5 if key didn't exist; ignore that safely
			if p.val == "" && (strings.TrimSpace(stderr) == "" || strings.Contains(err.Error(), "exit status 5")) {
				continue
			}
			return OpResult{
				Success: false,
				Message: firstNonEmpty(strings.TrimSpace(stderr), strings.TrimSpace(stdout), err.Error()),
			}, nil
		}
	}

	targetLabel := "Global (Windows)"
	if isLocal {
		targetLabel = "Repository (" + loc.Name + ")"
	} else if loc.IsWSL {
		targetLabel = "Global (WSL2 · " + loc.Distro + ")"
	}
	return OpResult{
		Success: true,
		Message: "Saved Git config to " + targetLabel,
	}, nil
}
