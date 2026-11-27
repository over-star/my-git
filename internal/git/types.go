package git

// RepoLocation describes a Git repository on either Windows local filesystem or WSL2.
type RepoLocation struct {
	Path          string `json:"path"`
	Name          string `json:"name"`
	IsWSL         bool   `json:"isWsl"`
	Distro        string `json:"distro"`
	LinuxPath     string `json:"linuxPath"`
	CommonDir     string `json:"commonDir"`
	IsWorktree    bool   `json:"isWorktree"`
	GitVersion    string `json:"gitVersion"`
	CurrentBranch string `json:"currentBranch"`
	HeadSHA       string `json:"headSha"`
	IsDetached    bool   `json:"isDetached"`
	MergeState    string `json:"mergeState"`
	Upstream      string `json:"upstream"`
	Ahead         int    `json:"ahead"`
	Behind        int    `json:"behind"`
}

// RecentRepo stores metadata for recently opened repositories.
type RecentRepo struct {
	Path       string `json:"path"`
	Name       string `json:"name"`
	IsWSL      bool   `json:"isWsl"`
	Distro     string `json:"distro"`
	LinuxPath  string `json:"linuxPath"`
	Pinned     bool   `json:"pinned"`
	LastOpened string `json:"lastOpened"`
}

// WSLDistro represents an installed WSL2 distribution.
type WSLDistro struct {
	Name        string `json:"name"`
	DefaultHome string `json:"defaultHome"`
}

// WSLEntry represents a directory entry inside a WSL2 filesystem.
type WSLEntry struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	IsDir bool   `json:"isDir"`
	IsGit bool   `json:"isGit"`
}

// FileStatus represents a single file in the working tree or staging area.
type FileStatus struct {
	Path       string `json:"path"`
	OrigPath   string `json:"origPath"`
	Status     string `json:"status"` // A, M, D, R, U, ?
	Staged     bool   `json:"staged"`
	Additions  int    `json:"additions"`
	Deletions  int    `json:"deletions"`
	IsBinary   bool   `json:"isBinary"`
	Conflicted bool   `json:"conflicted"`
}

// RepoStatus aggregates current repository status.
type RepoStatus struct {
	Branch      string       `json:"branch"`
	HeadSHA     string       `json:"headSha"`
	IsDetached  bool         `json:"isDetached"`
	Upstream    string       `json:"upstream"`
	Ahead       int          `json:"ahead"`
	Behind      int          `json:"behind"`
	MergeState  string       `json:"mergeState"` // "", "merge", "rebase", "cherry-pick"
	MergeBranch string       `json:"mergeBranch"`
	Unstaged    []FileStatus `json:"unstaged"`
	Staged      []FileStatus `json:"staged"`
	Conflicted  []FileStatus `json:"conflicted"`
}

// DiffLine represents a single line in a diff hunk.
type DiffLine struct {
	Type    string `json:"type"` // "context", "add", "del"
	OldLine int    `json:"oldLine"`
	NewLine int    `json:"newLine"`
	Content string `json:"content"`
}

// DiffHunk represents a contiguous hunk of changes in a diff.
type DiffHunk struct {
	Header   string     `json:"header"`
	OldStart int        `json:"oldStart"`
	OldCount int        `json:"oldCount"`
	NewStart int        `json:"newStart"`
	NewCount int        `json:"newCount"`
	Lines    []DiffLine `json:"lines"`
}

// FileDiff holds parsed diff output or binary size metadata.
type FileDiff struct {
	Path       string     `json:"path"`
	OldPath    string     `json:"oldPath"`
	ModeChange string     `json:"modeChange"`
	IsBinary   bool       `json:"isBinary"`
	OldSize    int64      `json:"oldSize"`
	NewSize    int64      `json:"newSize"`
	Additions  int        `json:"additions"`
	Deletions  int        `json:"deletions"`
	Hunks      []DiffHunk `json:"hunks"`
	Truncated  bool       `json:"truncated"`
	RawError   string     `json:"rawError"`
}

// RefBadge represents a branch or tag pointing to a commit.
type RefBadge struct {
	Name string `json:"name"`
	Type string `json:"type"` // "head", "local", "remote", "tag"
}

// CommitItem represents a row in the commit history list.
type CommitItem struct {
	Hash          string     `json:"hash"`
	ShortHash     string     `json:"shortHash"`
	Parents       []string   `json:"parents"`
	Author        string     `json:"author"`
	Email         string     `json:"email"`
	Timestamp     int64      `json:"timestamp"`
	RelativeTime  string     `json:"relativeTime"`
	DateFormatted string     `json:"dateFormatted"`
	Subject       string     `json:"subject"`
	Body          string     `json:"body"`
	Refs          []RefBadge `json:"refs"`
}

// RecentCommitMessage represents a recent commit's message for quick reuse when committing.
type RecentCommitMessage struct {
	Hash         string `json:"hash"`
	ShortHash    string `json:"shortHash"`
	Subject      string `json:"subject"`
	Body         string `json:"body"`
	Author       string `json:"author"`
	RelativeTime string `json:"relativeTime"`
}

// CommitPage represents a paginated slice of commit history.
type CommitPage struct {
	Commits []CommitItem `json:"commits"`
	HasMore bool         `json:"hasMore"`
}

// CommitFileChange represents a file modified in a specific commit.
type CommitFileChange struct {
	Path      string `json:"path"`
	OrigPath  string `json:"origPath"`
	Status    string `json:"status"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
	IsBinary  bool   `json:"isBinary"`
}

// CommitTreeEntry represents a file in the repository snapshot at a commit.
type CommitTreeEntry struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
}

// CommitFileContent holds the raw text (or binary metadata) of a file at a commit.
type CommitFileContent struct {
	Path      string `json:"path"`
	Size      int64  `json:"size"`
	IsBinary  bool   `json:"isBinary"`
	Truncated bool   `json:"truncated"`
	Content   string `json:"content"`
	RawError  string `json:"rawError"`
}

// CommitDetail holds full commit metadata and changed files.
type CommitDetail struct {
	Hash          string             `json:"hash"`
	ShortHash     string             `json:"shortHash"`
	Parents       []string           `json:"parents"`
	Author        string             `json:"author"`
	Email         string             `json:"email"`
	DateFormatted string             `json:"dateFormatted"`
	RelativeTime  string             `json:"relativeTime"`
	Subject       string             `json:"subject"`
	Body          string             `json:"body"`
	Files         []CommitFileChange `json:"files"`
}

// BranchInfo represents a local or remote branch.
type BranchInfo struct {
	Name       string `json:"name"`
	FullName   string `json:"fullName"`
	IsCurrent  bool   `json:"isCurrent"`
	IsRemote   bool   `json:"isRemote"`
	RemoteName string `json:"remoteName"`
	Upstream   string `json:"upstream"`
	Ahead      int    `json:"ahead"`
	Behind     int    `json:"behind"`
	LastSHA    string `json:"lastSha"`
	LastMsg    string `json:"lastMsg"`
}

// TagInfo represents a Git tag.
type TagInfo struct {
	Name    string `json:"name"`
	Hash    string `json:"hash"`
	Message string `json:"message"`
}

// StashItem represents a single stash entry.
type StashItem struct {
	Index        int    `json:"index"`
	Ref          string `json:"ref"`
	Branch       string `json:"branch"`
	Message      string `json:"message"`
	RelativeTime string `json:"relativeTime"`
}

// ConflictBlock represents a parsed conflict marker region in a file.
type ConflictBlock struct {
	Index       int      `json:"index"`
	StartLine   int      `json:"startLine"`
	EndLine     int      `json:"endLine"`
	OursLabel   string   `json:"oursLabel"`
	BaseLabel   string   `json:"baseLabel"`
	TheirsLabel string   `json:"theirsLabel"`
	OursLines   []string `json:"oursLines"`
	BaseLines   []string `json:"baseLines"`
	TheirsLines []string `json:"theirsLines"`
}

// ConflictFileContent holds raw text and parsed conflict blocks for a conflicted file.
type ConflictFileContent struct {
	Path         string          `json:"path"`
	RawContent   string          `json:"rawContent"`
	Blocks       []ConflictBlock `json:"blocks"`
	HasConflicts bool            `json:"hasConflicts"`
}

// CloneProgressEvent streams clone progress to the frontend.
type CloneProgressEvent struct {
	ID      string `json:"id"`
	Stage   string `json:"stage"`
	Percent int    `json:"percent"`
	Message string `json:"message"`
	Done    bool   `json:"done"`
	Error   string `json:"error"`
}

// OpResult reports the result of mutating Git operations.
type OpResult struct {
	Success   bool   `json:"success"`
	Message   string `json:"message"`
	ErrorCode string `json:"errorCode"` // "", "CONFLICT", "DIRTY_WORKTREE", "WORKTREE_IN_USE", "LOCKED_WORKTREE", "NOT_GIT_REPO", "NO_UPSTREAM", "AUTHOR_IDENTITY_UNKNOWN"
	Output    string `json:"output"`
}

// WorktreeInfo describes a Git worktree associated with a repository.
type WorktreeInfo struct {
	Path        string `json:"path"`        // Canonical RepoLocation path (Windows path or wsl://distro/path)
	RawPath     string `json:"rawPath"`     // Display path (Windows path or Linux path for WSL)
	Name        string `json:"name"`        // Base directory name
	HeadSHA     string `json:"headSha"`     // Short commit SHA
	FullSHA     string `json:"fullSha"`     // Full commit SHA
	Branch      string `json:"branch"`      // Short branch name (empty if bare or detached)
	BranchFull  string `json:"branchFull"`  // Full branch ref (e.g. refs/heads/main)
	IsMain      bool   `json:"isMain"`      // Primary worktree
	IsCurrent   bool   `json:"isCurrent"`   // Matches queried RepoLocation
	IsBare      bool   `json:"isBare"`
	IsDetached  bool   `json:"isDetached"`
	IsLocked    bool   `json:"isLocked"`
	LockReason  string `json:"lockReason"`
	IsPrunable  bool   `json:"isPrunable"`
	PruneReason string `json:"pruneReason"`
}

// AddWorktreeResult reports the outcome of creating a new worktree along with its validated RepoLocation.
type AddWorktreeResult struct {
	Result OpResult     `json:"result"`
	Repo   RepoLocation `json:"repo"`
}

// GitIdentity holds common user and behavior git config keys.
type GitIdentity struct {
	UserName      string `json:"userName"`
	UserEmail     string `json:"userEmail"`
	DefaultBranch string `json:"defaultBranch"`
	AutoCRLF      string `json:"autoCrlf"`
	PullRebase    string `json:"pullRebase"`
	GPGSign       string `json:"gpgSign"` // "", "true", "false"
	SigningKey    string `json:"signingKey"`
	SSHCommand    string `json:"sshCommand"`
}

// SSHKeyInfo describes a discovered SSH private key file.
type SSHKeyInfo struct {
	Name   string `json:"name"`
	Path   string `json:"path"`
	Source string `json:"source"` // "windows" or "wsl"
}

// RemoteInfo describes a configured Git remote.
type RemoteInfo struct {
	Name     string `json:"name"`
	FetchURL string `json:"fetchUrl"`
	PushURL  string `json:"pushUrl"`
	IsSSH    bool   `json:"isSsh"`
}

// GitConfigBundle returns local, global, and effective config for a repo or environment.
type GitConfigBundle struct {
	RepoName      string      `json:"repoName"`
	RepoPath      string      `json:"repoPath"`
	IsWSL         bool        `json:"isWsl"`
	Distro        string      `json:"distro"`
	ScopeEnvLabel string      `json:"scopeEnvLabel"`
	Effective     GitIdentity `json:"effective"`
	Local         GitIdentity `json:"local"`
	Global        GitIdentity `json:"global"`
}

// GitConfigUpdate represents values to write to local or global git config.
type GitConfigUpdate struct {
	RepoPath      string `json:"repoPath"`
	Scope         string `json:"scope"`  // "local" or "global"
	Distro        string `json:"distro"` // non-empty targets that WSL2 distro for global config
	UserName      string `json:"userName"`
	UserEmail     string `json:"userEmail"`
	DefaultBranch string `json:"defaultBranch"`
	AutoCRLF      string `json:"autoCrlf"`
	PullRebase    string `json:"pullRebase"`
	GPGSign       string `json:"gpgSign"`
	SigningKey    string `json:"signingKey"`
	SSHCommand    string `json:"sshCommand"`
}

// CommandEvent describes an executed git operation command for live UI echoing.
type CommandEvent struct {
	ID         string `json:"id"`
	RepoPath   string `json:"repoPath"`
	Command    string `json:"command"`
	Status     string `json:"status"` // "running", "success", "error"
	Error      string `json:"error,omitempty"`
	DurationMs int64  `json:"durationMs"`
	Timestamp  int64  `json:"timestamp"`
}
