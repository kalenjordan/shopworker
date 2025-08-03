# create-shopworker

CLI tool to create and set up Shopworker instances with symlinks.

## Usage

Run directly with npx:

```bash
npx create-shopworker
```

Or install globally:

```bash
npm install -g create-shopworker
create-shopworker
```

## What it does

This CLI tool helps you set up a new Shopworker instance by:

1. Cloning the main Shopworker repository
2. Creating a GitHub repository for your account-specific code
3. Setting up a symlink-based structure to keep your code separate
4. Initializing with template files including a hello-world job example

## Architecture

The tool creates a symlink-based structure:

```
shopworker-demo/              # Main Shopworker repository
├── core/                     # Core Shopworker code
├── jobs/                     # Core jobs
├── triggers/                 # Core triggers
├── connectors/               # Core connectors
├── local/                    # Symlink → shopworker-demo-local
└── .gitignore                # Ignores /local

shopworker-demo-local/        # Your account-specific repository
├── jobs/                     # Your custom jobs
├── triggers/                 # Your custom triggers
└── connectors/               # Your custom connectors
```

This architecture:
- **Keeps code separate**: Main and account repos are independent
- **Simple to understand**: Just symlinks, no complex git worktrees
- **Easy updates**: Pull main repo updates without conflicts
- **Clean git history**: Each repo has its own history

## Prerequisites

- Node.js 16+
- Git
- GitHub CLI (`gh`) - [Install instructions](https://cli.github.com/)

## Example

### In an empty directory:

```bash
$ mkdir shopworker-demo && cd shopworker-demo
$ npx create-shopworker

🛍️  Create Shopworker Instance

Using current directory: shopworker-demo

✔ Repository name: › shopworker-demo
✔ Create private repository? › Yes

✅ Shopworker instance created successfully!

Structure:
  shopworker-demo/            - Main Shopworker repository
    ├── core/                 - Core Shopworker code
    └── local/                - Symlink to shopworker-demo-local
  shopworker-demo-local/      - Your account-specific code
    ├── jobs/
    ├── triggers/
    └── connectors/

Next steps:
  1. Configure .shopworker.json with your Shopify credentials
  2. Set up .env with your environment variables
  3. Install dependencies: npm install
  4. Create your custom jobs in local/jobs/
  5. Deploy with: npm run deploy
```

### In a non-empty directory:

```bash
$ cd ~/projects
$ npx create-shopworker

🛍️  Create Shopworker Instance

✔ Repository name: › shopworker-acme
✔ Create private repository? › Yes
✔ Directory name for Shopworker instance: › shopworker-acme

✅ Creates shopworker-acme/ and shopworker-acme-local/ directories
```

## Working with the Structure

- **Main repository** (`shopworker-demo/`): Contains core Shopworker code
- **Account repository** (`shopworker-demo-local/`): Contains your custom code
- **Symlink** (`shopworker-demo/local/`): Points to your account repository

To update the main Shopworker code:
```bash
cd shopworker-demo
git pull origin main
```

To push your custom code:
```bash
cd shopworker-demo-local
git add .
git commit -m "Add custom job"
git push
```

## Development

To work on this CLI tool:

```bash
git clone <this-repo>
cd init-cli
npm install
npm link  # Makes 'create-shopworker' available globally for testing
```