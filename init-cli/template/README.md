# {REPO_NAME}

Shopworker instance for {ACCOUNT_NAME}.

## Structure

This repository contains your account-specific Shopworker configuration:

- `jobs/` - Account-specific jobs
- `triggers/` - Account-specific triggers  
- `connectors/` - Account-specific connectors

## Usage

This repository is designed to be used as a git worktree within the main Shopworker repository.

When cloned as a worktree into the main Shopworker repo, your custom code will be available at:
- `local/jobs/`
- `local/triggers/`
- `local/connectors/`

## Creating Jobs

Jobs should be created in the `jobs/` directory. See `jobs/hello-world/` for an example.

Each job needs:
- `config.json` - Job configuration
- `job.js` - Job implementation

## Pushing Changes

To push changes to this repository:

```bash
git add .
git commit -m "Your commit message"
git push origin main
```