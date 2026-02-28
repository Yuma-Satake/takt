/**
 * takt review post — post review summary to a PR comment.
 *
 * Finds the latest review run, reads review-summary.md from its reports,
 * and posts it as a comment on the current branch's PR.
 *
 * Usage:
 *   takt review post                    # Post latest review summary to current PR
 *   takt review post --run <slug>       # Post specific run's summary
 *   takt review post --pr <number>      # Override PR number
 *   takt review post --dry-run          # Preview without posting
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listRecentRuns, getRunPaths } from '../../features/interactive/runSessionReader.js';
import { getGitProvider } from '../../infra/git/index.js';
import { getCurrentBranch } from '../../infra/task/git.js';
import { info, error, success } from '../../shared/ui/index.js';

const REVIEW_SUMMARY_FILENAME = 'review-summary.md';

export interface ReviewPostOptions {
  /** Specific run slug to post */
  run?: string;
  /** Override PR number (auto-detected if omitted) */
  pr?: number;
  /** Preview without posting */
  dryRun?: boolean;
}

/**
 * Find the latest review run's summary file path.
 * Returns the absolute path to review-summary.md, or null if not found.
 */
export function findLatestReviewSummary(
  cwd: string,
  runSlug?: string,
): { summaryPath: string; slug: string } | null {
  if (runSlug) {
    try {
      const paths = getRunPaths(cwd, runSlug);
      const summaryPath = join(paths.reportsDir, REVIEW_SUMMARY_FILENAME);
      if (existsSync(summaryPath)) {
        return { summaryPath, slug: runSlug };
      }
    } catch {
      // Run not found
    }
    return null;
  }

  // Search recent runs for a review piece
  const runs = listRecentRuns(cwd);
  for (const run of runs) {
    if (run.piece !== 'review') continue;
    try {
      const paths = getRunPaths(cwd, run.slug);
      const summaryPath = join(paths.reportsDir, REVIEW_SUMMARY_FILENAME);
      if (existsSync(summaryPath)) {
        return { summaryPath, slug: run.slug };
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Detect the PR number for the current branch.
 */
export function detectPrNumber(cwd: string): number | undefined {
  try {
    const branch = getCurrentBranch(cwd);
    const pr = getGitProvider().findExistingPr(cwd, branch);
    return pr?.number;
  } catch {
    return undefined;
  }
}

export async function reviewPostCommand(
  cwd: string,
  options: ReviewPostOptions,
): Promise<void> {
  // 1. Find review summary
  const result = findLatestReviewSummary(cwd, options.run);
  if (!result) {
    if (options.run) {
      error(`Review summary not found for run: ${options.run}`);
    } else {
      error(`No review run found. Run \`takt -t "<target>" -w review\` first.`);
    }
    process.exitCode = 1;
    return;
  }

  const summaryContent = readFileSync(result.summaryPath, 'utf-8');
  if (!summaryContent.trim()) {
    error(`Review summary is empty: ${result.summaryPath}`);
    process.exitCode = 1;
    return;
  }

  info(`Found review summary: .takt/runs/${result.slug}/reports/${REVIEW_SUMMARY_FILENAME}`);

  // 2. Resolve PR number
  const prNumber = options.pr ?? detectPrNumber(cwd);
  if (!prNumber) {
    error('Could not detect PR number. Use --pr <number> to specify it.');
    process.exitCode = 1;
    return;
  }

  info(`Target PR: #${prNumber}`);

  // 3. Post or preview
  if (options.dryRun) {
    info('\n--- Review Summary (dry-run) ---\n');
    info(summaryContent);
    info('\n--- End of Review Summary ---');
    return;
  }

  const gitProvider = getGitProvider();
  const commentResult = gitProvider.commentOnPr(cwd, prNumber, summaryContent);

  if (commentResult.success) {
    success(`Review summary posted to PR #${prNumber}`);
  } else {
    error(`Failed to post comment: ${commentResult.error}`);
    process.exitCode = 1;
  }
}
