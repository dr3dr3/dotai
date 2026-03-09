# DevContainer

## VS Code Extensions

The following extensions are pre-installed in this devcontainer.

### GitHub Pull Requests (`github.vscode-pull-request-github`)

Manage GitHub pull requests and issues directly in VS Code.

* Open the **GitHub Pull Requests** panel in the Activity Bar to view open PRs
* Create, review, and merge pull requests without leaving the editor
* Checkout a PR branch directly from the PR list
* Leave inline review comments on diffs

### GitHub Copilot (`github.copilot`)

AI-powered code completions and chat assistance.

* Completions appear inline as you type — press `Tab` to accept
* Open Copilot Chat via `Ctrl+Alt+I` to ask questions or generate code
* Use `Ctrl+I` for inline edits on a selected block of code
* Use `/explain`, `/fix`, `/tests` slash commands in the chat panel

### AWS Toolkit (`amazonwebservices.aws-toolkit-vscode`)

Browse and interact with AWS services from within VS Code.

* Sign in via the **AWS** panel in the Activity Bar
* Browse S3 buckets, Lambda functions, CloudFormation stacks, and more
* Open the **AWS Explorer** to navigate resources in `ap-southeast-2` (pre-configured)
* Run and debug Lambda functions locally

### Prettier (`esbenp.prettier-vscode`)

Opinionated code formatter for JS/TS, JSON, Markdown, and more.

* Format the current file with `Shift+Alt+F`
* Enable **Format on Save** in settings for automatic formatting
* Add a `.prettierrc` file to the workspace root to customise rules

### ESLint (`dbaeumer.vscode-eslint`)

Lint JavaScript and TypeScript files using ESLint.

* Lint errors and warnings appear inline with squiggles
* Fix all auto-fixable issues in a file via `Ctrl+Shift+P` → **ESLint: Fix all auto-fixable Problems**
* Requires an ESLint config (`eslint.config.js` or `.eslintrc`) in the workspace

### Docker (`ms-azuretools.vscode-docker`)

Build, manage, and deploy containerised applications.

* Open the **Docker** panel in the Activity Bar to view images, containers, and registries
* Right-click a `Dockerfile` to build an image directly
* View running container logs and open a shell inside a container from the panel

### Live Server (`ms-vscode.live-server`)

Spin up a local development server with live reload for static files.

* Right-click an HTML file and select **Open with Live Server**
* Or click **Go Live** in the status bar
* The browser auto-refreshes on every file save
