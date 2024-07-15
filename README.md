# Gitlab Merge Features

Create a new branch from the master branch and merge all MR only if it's ready.

## Usage

```bash 
npx --no-install gitlab-merge merge --token $CI_TOKEN --project-id $CI_PROJECT_ID --clone $CI_REPOSITORY_URL --dir .
```

## Options

- `--gitlab-url` Gitlab url, default `https://gitlab.com
- `--token` Gitlab token
- `--project-id` Gitlab project id
- `--clone` Gitlab repository url
- `--dir` Branch name
- `--branch-pattern` Branch pattern, default `feature/*`
- `--source-branch` Source branch, default `master`
- `--destination-branch` Target branch, default `dev`
- `--no-pipeline` Disable check pipeline, default `false`
- `--accept-draft` Accept draft MR, default `false`