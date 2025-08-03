# create-shopworker

CLI tool to create and set up Shopworker instances with git worktrees.

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

1. Creating a new GitHub repository for your account-specific Shopworker configuration
2. Cloning the main Shopworker repository
3. Setting up git worktrees to link account-specific directories (jobs, triggers, connectors)
4. Creating a template structure with example files

## Architecture

Each Shopworker instance consists of:

- **Main Repository**: The core Shopworker codebase (cloned as `shopworker-main/`)
- **Account Repository**: Your account-specific configuration and custom jobs
- **Git Worktrees**: Links the account-specific directories to branches in the main repo

This architecture allows you to:
- Keep your custom code separate from the core Shopworker code
- Easily pull updates from the main Shopworker repository
- Maintain account-specific configurations in their own repositories

## Prerequisites

- Node.js 16+
- Git
- GitHub CLI (`gh`) - [Install instructions](https://cli.github.com/)

## Example

```bash
$ npx create-shopworker

🛍️  Create Shopworker Instance

✔ Account name (e.g., acme-corp): › acme-corp
✔ Repository name: › shopworker-acme-corp
✔ Create private repository? › Yes
✔ Main Shopworker repository URL: › https://github.com/your-org/shopworker.git
✔ Local directory path: › ./acme-corp

✅ Shopworker instance created successfully!

Next steps:
  1. cd ./acme-corp
  2. Configure .shopworker.json with your Shopify credentials
  3. Set up .env with your environment variables
  4. Create your custom jobs in the jobs/ directory
  5. Deploy with: npm run deploy
```

## Development

To work on this CLI tool:

```bash
git clone <this-repo>
cd create-shopworker
npm install
npm link  # Makes 'create-shopworker' available globally for testing
```