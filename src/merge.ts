import { Gitlab, Types } from '@gitbeaker/node';
import { Resources } from '@gitbeaker/core';
import lodash from 'lodash';
import chalk from 'chalk';
import { simpleGit, SimpleGit } from 'simple-git';
import { Command } from 'commander';
import fs from 'fs';

const ISSUE_REGEX = new RegExp('([a-zA-Z0-9_-]+(/[a-zA-Z0-9_-]+)*)?#[0-9][0-9]*', 'gi');

interface Options {
  gitlabUrl: string;
  token: string;
  projectId: string;
  branchPattern: string;
  clone?: string;
  dir: string;
  sourceBranch: string;
  destinationBranch: string;
  noPipeline: boolean;
  acceptDraft: boolean;
  dryRun: boolean;
}

export async function merge(command: Command): Promise<void> {
  const {
    gitlabUrl, token, projectId,
    branchPattern, clone, dir, sourceBranch,
    destinationBranch, noPipeline, acceptDraft, dryRun
  } = command.optsWithGlobals<Options>();

  const api = new Gitlab({
    host: gitlabUrl,
    token: token
  });

  if (dir != null && dir !== '.' && dir !== '/.' && clone != null) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.mkdirSync(dir);
  }

  const git = simpleGit(dir);

  if (clone != null) {
    console.info(chalk.black(`Clone project with ${clone}`));

    await git.clone(clone, '.', ['-q']);
  }

  console.info(chalk.black(`Checkout source branche origin/${sourceBranch}`));
  await git.checkout(['-q', '--track', `origin/${sourceBranch}`]).catch(() => null);

  const bp = new RegExp(branchPattern);

  const mrs = await api.MergeRequests.all({
    projectId: projectId,
    state: 'opened',
    perPage: 100,
    maxPages: 10
  }).catch(err => {
    console.error(chalk.red(`Failed to get all merge request`), err);
    return [];
  });

  console.info(chalk.blue(`Found ${mrs.length} merge request opened`));

  const filteredMrs = lodash.sortBy(mrs.filter(mr => {
    if (!bp.test(mr.source_branch)) {
      return false;
    }
    if (!acceptDraft && (mr.draft || mr.work_in_progress)) {
      console.info(chalk.yellowBright(`${mr.source_branch} is draft`));
      return false;
    }
    return true;
  }), 'created_at');

  for (const mr of filteredMrs) {
    const status = await checkMergeRequestStatus(api, mr);

    console.info(chalk.blueBright(`Merge request ${mr.source_branch} is ${status}`));

    if (status === 'mergeable' || (noPipeline && (status === 'ci_must_pass' || status === 'ci_still_running'))) {
      await mergeMr(api, git, mr);
    } else if (status === 'ci_must_pass' || status === 'ci_still_running') {
      console.info(chalk.blueBright(`Verify pipeline for ${mr.source_branch}`));

      const ps = await verifyPipeline(api, mr);
      if (ps === 'success') {
        await mergeMr(api, git, mr);
      } else {
        console.info(chalk(chalk.redBright(`Merge request for ${mr.source_branch}, pipeline is ${ps ?? 'not-found'}`)));
      }
    } else {
      console.info(chalk(chalk.redBright(`Merge request for ${mr.source_branch} is ignored because status is ${status}`)));
    }
  }

  if (!dryRun) {
    console.info(chalk.black(`Push force to ${destinationBranch}`));
    await git.push(['-f', 'origin', `HEAD:${destinationBranch}`]);
  } else {
    console.info(chalk.black(`Dry run, no push`));
  }
}

async function verifyPipeline(api: InstanceType<typeof Gitlab>, mr: Types.MergeRequestSchema): Promise<string | undefined> {
  const p = lodash.head(await api.Pipelines.all(mr.project_id, {
    ref: mr.source_branch,
    perPage: 1,
    maxPages: 1
  }));
  return p?.status;
}

async function mergeMr(api: Resources.Gitlab, git: SimpleGit, mr: Types.MergeRequestSchema): Promise<void> {
  try {
    await git.merge([`origin/${mr.source_branch}`, '--no-ff']);

    console.info(chalk.greenBright(`Merge ${mr.source_branch}`));
  } catch (err) {
    console.error(chalk.redBright(`Failed to merge ${mr.source_branch}, rollback`), err);

    await git.merge(['--abort']).catch(() => null);

    if (!mr.work_in_progress && !mr.title.startsWith('Draft: ')) {
      console.info(chalk.blueBright(`Set draft merge request ${mr.iid} on ${mr.source_branch}`));

      await api.MergeRequests.edit(mr.project_id, mr.iid, {
        title: `Draft: ${mr.title}`
      }).catch(() => null);

      await api.MergeRequestNotes.create(mr.project_id, mr.iid, '[AUTOMERGE][FAILED] Conflit with other merge request').catch(() => null);
    }
  }
}

async function checkMergeRequestStatus(api: Resources.Gitlab, mr: Types.MergeRequestSchema): Promise<string> {
  let count = 0;
  while (count < 10) {
    if (mr.detailed_merge_status !== 'unchecked' && mr.detailed_merge_status !== 'checked') {
      return mr.detailed_merge_status as string;
    }

    console.info(chalk.yellowBright(`Waiting ${mr.source_branch} is ${mr.detailed_merge_status}`));

    await timeout(5000);

    mr = await api.MergeRequests.show(mr.project_id, mr.iid);
    count++;
  }
  return mr.detailed_merge_status as string;
}

function timeout(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function findIssues(api: Resources.Gitlab, mr: Types.MergeRequestSchema): Promise<Types.IssueSchema[]> {
  const commits = await api.MergeRequests.commits(mr.project_id, mr.iid);

  const issues = lodash.uniq(commits.reduce((acc, x) => {
    const match = x.title.match(ISSUE_REGEX);
    if (match != null && match?.length > 0) {
      match.forEach((m) => {
        const diezePos = m.indexOf('#');
        const href = diezePos === 0 ? `${mr.project_id}${m}` : m;
        acc.push(href);
      });
    }
    return acc;
  }, [] as string[]));

  const res = await Promise.all(issues.map(async x => {
    const diezePos = x.indexOf('#');
    const issue = x.substring(diezePos + 1);
    const group = x.substring(0, diezePos);

    return api.Issues.show(group, Number(issue)).catch(() => null);
  }));

  return res.filter(r => r != null) as Types.IssueSchema[];
}
