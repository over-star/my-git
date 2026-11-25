package git

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"unicode/utf16"
)

// ParseRepoLocation parses a Windows path, UNC WSL path (\\wsl$\... or \\wsl.localhost\...),
// or wsl:// URI into a normalized RepoLocation.
func ParseRepoLocation(rawPath string) RepoLocation {
	trimmed := strings.TrimSpace(rawPath)
	if trimmed == "" {
		return RepoLocation{}
	}

	// Handle wsl://distro/path
	if strings.HasPrefix(strings.ToLower(trimmed), "wsl://") {
		rest := trimmed[6:]
		parts := strings.SplitN(rest, "/", 2)
		distro := parts[0]
		linuxPath := "/"
		if len(parts) > 1 && parts[1] != "" {
			linuxPath = "/" + strings.TrimLeft(parts[1], "/")
		}
		winPath := `\\wsl.localhost\` + distro + strings.ReplaceAll(linuxPath, "/", `\`)
		name := path.Base(linuxPath)
		if name == "/" || name == "." || name == "" {
			name = distro
		}
		return RepoLocation{
			Path:      winPath,
			Name:      name,
			IsWSL:     true,
			Distro:    distro,
			LinuxPath: linuxPath,
		}
	}

	// Handle \\wsl$\Distro\... or \\wsl.localhost\Distro\...
	normalized := strings.ReplaceAll(trimmed, "/", `\`)
	lower := strings.ToLower(normalized)
	for _, prefix := range []string{`\\wsl.localhost\`, `\\wsl$\`} {
		if strings.HasPrefix(lower, prefix) {
			rest := normalized[len(prefix):]
			parts := strings.SplitN(rest, `\`, 2)
			distro := parts[0]
			linuxPath := "/"
			if len(parts) > 1 && parts[1] != "" {
				linuxPath = "/" + strings.ReplaceAll(strings.TrimLeft(parts[1], `\`), `\`, "/")
			}
			linuxPath = path.Clean(linuxPath)
			winPath := `\\wsl.localhost\` + distro
			if linuxPath != "/" {
				winPath += strings.ReplaceAll(linuxPath, "/", `\`)
			}
			name := path.Base(linuxPath)
			if name == "/" || name == "." || name == "" {
				name = distro
			}
			return RepoLocation{
				Path:      winPath,
				Name:      name,
				IsWSL:     true,
				Distro:    distro,
				LinuxPath: linuxPath,
			}
		}
	}

	// Standard local path
	clean := filepath.Clean(trimmed)
	name := filepath.Base(clean)
	if name == "" || name == "." {
		name = clean
	}
	return RepoLocation{
		Path:  clean,
		Name:  name,
		IsWSL: false,
	}
}

// RunGit executes a git command inside the repository (local or WSL2).
func RunGit(ctx context.Context, loc RepoLocation, args ...string) (string, string, error) {
	return runGitWithDir(ctx, loc, false, args...)
}

// RunGitNoDir executes git without requiring the repo directory to exist yet (used for clone).
func RunGitInDir(ctx context.Context, loc RepoLocation, args ...string) (string, string, error) {
	return runGitWithDir(ctx, loc, true, args...)
}

func runGitWithDir(ctx context.Context, loc RepoLocation, skipCD bool, args ...string) (string, string, error) {
	fullArgs := append([]string{"-c", "core.quotepath=false"}, args...)
	var cmd *exec.Cmd
	if loc.IsWSL {
		wslArgs := []string{"-d", loc.Distro}
		if !skipCD && loc.LinuxPath != "" {
			wslArgs = append(wslArgs, "--cd", loc.LinuxPath)
		}
		wslArgs = append(wslArgs, "--", "git")
		wslArgs = append(wslArgs, fullArgs...)
		cmd = exec.CommandContext(ctx, "wsl.exe", wslArgs...)
		cmd.Env = append(os.Environ(),
			"GIT_TERMINAL_PROMPT=0",
			"LC_ALL=C.UTF-8",
			"WSLENV=GIT_TERMINAL_PROMPT/u:LC_ALL/u",
		)
	} else {
		cmd = exec.CommandContext(ctx, "git", fullArgs...)
		if !skipCD && loc.Path != "" {
			cmd.Dir = loc.Path
		}
		cmd.Env = append(os.Environ(),
			"GIT_TERMINAL_PROMPT=0",
			"LC_ALL=C.UTF-8",
		)
	}
	hideWindow(cmd)

	var stdoutBuf, stderrBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf

	err := cmd.Run()
	return stdoutBuf.String(), stderrBuf.String(), err
}

// ValidateGitRepo checks if the given path is a valid Git repository and returns enriched RepoLocation.
func ValidateGitRepo(ctx context.Context, rawPath string) (RepoLocation, error) {
	loc := ParseRepoLocation(rawPath)
	if loc.Path == "" {
		return loc, errors.New("repository path is empty")
	}

	if !loc.IsWSL {
		info, err := os.Stat(loc.Path)
		if err != nil || !info.IsDir() {
			return loc, fmt.Errorf("directory does not exist: %s", loc.Path)
		}
		dotGit := filepath.Join(loc.Path, ".git")
		if _, err := os.Stat(dotGit); err != nil {
			// Also allow worktrees/subdirectories via git rev-parse
			out, _, gerr := RunGit(ctx, loc, "rev-parse", "--show-toplevel")
			if gerr != nil || strings.TrimSpace(out) == "" {
				return loc, errors.New("NOT_GIT_REPO: selected folder is not a Git repository (.git not found)")
			}
			loc = ParseRepoLocation(strings.TrimSpace(out))
		}
	} else {
		out, errOut, gerr := RunGit(ctx, loc, "rev-parse", "--show-toplevel")
		if gerr != nil || strings.TrimSpace(out) == "" {
			msg := strings.TrimSpace(errOut)
			if strings.Contains(msg, "not a git repository") || msg == "" {
				return loc, errors.New("NOT_GIT_REPO: selected WSL2 folder is not a Git repository (.git not found)")
			}
			return loc, fmt.Errorf("WSL2 git error: %s", msg)
		}
		top := strings.TrimSpace(out)
		loc = ParseRepoLocation(fmt.Sprintf("wsl://%s%s", loc.Distro, top))
	}

	verOut, _, _ := RunGit(ctx, loc, "--version")
	loc.GitVersion = strings.TrimPrefix(strings.TrimSpace(verOut), "git version ")

	status, _ := GetRepoStatus(ctx, loc)
	loc.CurrentBranch = status.Branch
	loc.HeadSHA = status.HeadSHA
	loc.IsDetached = status.IsDetached
	loc.MergeState = status.MergeState
	loc.Upstream = status.Upstream
	loc.Ahead = status.Ahead
	loc.Behind = status.Behind

	return loc, nil
}

// InitRepo initializes a new Git repository in the target path.
func InitRepo(ctx context.Context, rawPath string) (RepoLocation, error) {
	loc := ParseRepoLocation(rawPath)
	if loc.Path == "" {
		return loc, errors.New("directory path is required")
	}
	if !loc.IsWSL {
		if err := os.MkdirAll(loc.Path, 0o755); err != nil {
			return loc, fmt.Errorf("failed to create directory: %w", err)
		}
	} else {
		cmd := exec.CommandContext(ctx, "wsl.exe", "-d", loc.Distro, "--", "mkdir", "-p", loc.LinuxPath)
		hideWindow(cmd)
		if out, err := cmd.CombinedOutput(); err != nil {
			return loc, fmt.Errorf("failed to create WSL directory: %s (%w)", strings.TrimSpace(string(out)), err)
		}
	}

	_, stderr, err := RunGit(ctx, loc, "init")
	if err != nil {
		return loc, fmt.Errorf("git init failed: %s (%w)", strings.TrimSpace(stderr), err)
	}
	return ValidateGitRepo(ctx, loc.Path)
}

// ListWSLDistros returns installed WSL2 distributions on Windows.
func ListWSLDistros(ctx context.Context) ([]WSLDistro, error) {
	if runtime.GOOS != "windows" {
		return nil, nil
	}
	cmd := exec.CommandContext(ctx, "wsl.exe", "-l", "-q")
	hideWindow(cmd)
	raw, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to list WSL distros: %w", err)
	}
	text := decodeWSLOutput(raw)
	lines := strings.Split(text, "\n")
	var distros []WSLDistro
	for _, line := range lines {
		name := strings.TrimSpace(strings.Trim(line, "\r\x00\ufeff"))
		if name == "" {
			continue
		}
		home := getWSLHome(ctx, name)
		distros = append(distros, WSLDistro{
			Name:        name,
			DefaultHome: home,
		})
	}
	return distros, nil
}

func getWSLHome(ctx context.Context, distro string) string {
	cmd := exec.CommandContext(ctx, "wsl.exe", "-d", distro, "--", "sh", "-c", "printf %s \"$HOME\"")
	hideWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return "/"
	}
	h := strings.TrimSpace(string(out))
	if h == "" {
		return "/"
	}
	return h
}

// BrowseWSLDir lists subdirectories inside a WSL2 directory and checks whether each is a Git repo.
func BrowseWSLDir(ctx context.Context, distro, linuxPath string) ([]WSLEntry, string, error) {
	if distro == "" {
		return nil, "", errors.New("WSL distro name is required")
	}
	target := strings.TrimSpace(linuxPath)
	if target == "" {
		target = getWSLHome(ctx, distro)
	}
	target = path.Clean(target)

	script := `cd "$1" 2>/dev/null || exit 1
pwd
for d in * .[!.]*; do
  [ -d "$d" ] || continue
  [ "$d" = ".git" ] && continue
  if [ -e "$d/.git" ]; then
    printf 'GIT\t%s\n' "$d"
  else
    printf 'DIR\t%s\n' "$d"
  fi
done`

	cmd := exec.CommandContext(ctx, "wsl.exe", "-d", distro, "--", "sh", "-c", script, "sh", target)
	hideWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return nil, target, fmt.Errorf("cannot open WSL path %s: %w", target, err)
	}

	lines := strings.Split(strings.ReplaceAll(string(out), "\r\n", "\n"), "\n")
	resolved := target
	var entries []WSLEntry
	for i, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if i == 0 && strings.HasPrefix(line, "/") {
			resolved = line
			continue
		}
		parts := strings.SplitN(line, "\t", 2)
		if len(parts) != 2 {
			continue
		}
		kind, name := parts[0], parts[1]
		if name == "." || name == ".." {
			continue
		}
		full := path.Join(resolved, name)
		entries = append(entries, WSLEntry{
			Name:  name,
			Path:  full,
			IsDir: true,
			IsGit: kind == "GIT",
		})
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsGit != entries[j].IsGit {
			return entries[i].IsGit
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	return entries, resolved, nil
}

func decodeWSLOutput(raw []byte) string {
	// wsl.exe -l -q outputs UTF-16LE on Windows.
	if len(raw) >= 2 && (raw[1] == 0x00 || (raw[0] == 0xff && raw[1] == 0xfe)) {
		start := 0
		if raw[0] == 0xff && raw[1] == 0xfe {
			start = 2
		}
		u16 := make([]uint16, 0, (len(raw)-start)/2)
		for i := start; i+1 < len(raw); i += 2 {
			u16 = append(u16, uint16(raw[i])|uint16(raw[i+1])<<8)
		}
		return string(utf16.Decode(u16))
	}
	return string(raw)
}

// OpenInExplorer opens the repository or selected file in Windows Explorer.
func OpenInExplorer(loc RepoLocation, relPath string) error {
	target := loc.Path
	if relPath != "" {
		cleanRel := strings.ReplaceAll(relPath, "/", `\`)
		target = filepath.Join(loc.Path, cleanRel)
	}
	var cmd *exec.Cmd
	if relPath != "" {
		cmd = exec.Command("explorer.exe", "/select,"+target)
	} else {
		cmd = exec.Command("explorer.exe", target)
	}
	return cmd.Start()
}

// OpenInTerminal opens a terminal inside the repository (WSL2 shell or PowerShell).
func OpenInTerminal(loc RepoLocation) error {
	if loc.IsWSL {
		if _, err := exec.LookPath("wt.exe"); err == nil {
			return exec.Command("wt.exe", "wsl.exe", "-d", loc.Distro, "--cd", loc.LinuxPath).Start()
		}
		return exec.Command("cmd.exe", "/c", "start", "wsl.exe", "-d", loc.Distro, "--cd", loc.LinuxPath).Start()
	}
	if _, err := exec.LookPath("wt.exe"); err == nil {
		return exec.Command("wt.exe", "-d", loc.Path).Start()
	}
	return exec.Command("cmd.exe", "/c", "start", "powershell.exe", "-NoExit", "-Command", fmt.Sprintf("Set-Location -LiteralPath '%s'", strings.ReplaceAll(loc.Path, "'", "''"))).Start()
}

// OpenInEditor opens a file or repository in VS Code if available, otherwise Windows default handler.
func OpenInEditor(loc RepoLocation, relPath string) error {
	if loc.IsWSL {
		target := loc.LinuxPath
		if relPath != "" {
			target = path.Join(loc.LinuxPath, relPath)
		}
		// Try WSL code CLI first, then Windows VS Code / Explorer fallback
		cmd := exec.Command("wsl.exe", "-d", loc.Distro, "--", "sh", "-c", `command -v code >/dev/null 2>&1 && code "$1"`, "sh", target)
		hideWindow(cmd)
		if err := cmd.Start(); err == nil {
			return nil
		}
		winTarget := loc.Path
		if relPath != "" {
			winTarget = filepath.Join(loc.Path, strings.ReplaceAll(relPath, "/", `\`))
		}
		return exec.Command("cmd.exe", "/c", "start", "", winTarget).Start()
	}

	target := loc.Path
	if relPath != "" {
		target = filepath.Join(loc.Path, strings.ReplaceAll(relPath, "/", `\`))
	}
	for _, editor := range []string{"code.cmd", "code", "cursor.cmd", "cursor"} {
		if p, err := exec.LookPath(editor); err == nil {
			c := exec.Command(p, target)
			hideWindow(c)
			return c.Start()
		}
	}
	return exec.Command("cmd.exe", "/c", "start", "", target).Start()
}
