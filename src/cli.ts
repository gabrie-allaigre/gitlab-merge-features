#!/usr/bin/env node
import { Command } from 'commander';
import { merge } from './merge';

export const createProgram = () => {
  const program = new Command();

  program
    .name('gitlab-merge-features')
    .description('CLI to merge features from Gitlab project')
    .version('1.0.0')
    .requiredOption('-g, --gitlab-url <string>', 'Gitlab Url', 'https://gitlab.com')
    .requiredOption('-t, --token <string>', 'Token')
    .requiredOption('-p, --project-id <string>', 'Project Id');

  program.command('merge')
    .requiredOption('--branch-pattern <string>', 'Branch pattern', 'feature/*')
    .option('-c, --clone <string>', 'Clone git project')
    .option('-b, --dir <string>', 'Working directory', 'temp')
    .option('-s, --source-branch <string>', 'Source branch', 'master')
    .option('-d, --destination-branch <string>', 'Destination branch', 'dev')
    .option('--no-pipeline', 'No check pipeline', false)
    .option('--accept-draft', 'Merge draft merge request', false)
    .action(async (opts, cmd) => {
      return merge(cmd);
    });

  return program;
};

if (require.main === module) {
  const program = createProgram();

  // Run the program.
  // From doc: Use parseAsync instead of parse if any of your action handlers are async. Returns a Promise.
  // Although parse() seem to work as well...
  program.parseAsync().then(() => {
    // make things more readable.
    console.log('\n');
  });
}
