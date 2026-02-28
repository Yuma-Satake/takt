/**
 * Tests for takt review post command
 *
 * Covers:
 * - findLatestReviewSummary: locating review-summary.md from runs
 * - reviewPostCommand: posting review summary to PR, dry-run, error cases
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../infra/git/index.js', () => ({
  getGitProvider: vi.fn(),
}));

vi.mock('../infra/task/git.js', () => ({
  getCurrentBranch: vi.fn(),
}));

import { getGitProvider } from '../infra/git/index.js';
import { getCurrentBranch } from '../infra/task/git.js';
import {
  findLatestReviewSummary,
  detectPrNumber,
  reviewPostCommand,
} from '../commands/review/post.js';

const mockGetGitProvider = vi.mocked(getGitProvider);
const mockGetCurrentBranch = vi.mocked(getCurrentBranch);

function createTmpDir(): string {
  const dir = join(tmpdir(), `takt-test-review-post-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createRunDir(
  cwd: string,
  slug: string,
  meta: Record<string, unknown>,
): string {
  const runDir = join(cwd, '.takt', 'runs', slug);
  mkdirSync(join(runDir, 'logs'), { recursive: true });
  mkdirSync(join(runDir, 'reports'), { recursive: true });
  writeFileSync(join(runDir, 'meta.json'), JSON.stringify(meta), 'utf-8');
  return runDir;
}

describe('findLatestReviewSummary', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return null when no runs exist', () => {
    const result = findLatestReviewSummary(tmpDir);
    expect(result).toBeNull();
  });

  it('should return null when runs exist but none are review piece', () => {
    createRunDir(tmpDir, 'run-default', {
      task: 'some task',
      piece: 'default',
      status: 'completed',
      startTime: '2026-01-01T00:00:00.000Z',
      logsDirectory: '.takt/runs/run-default/logs',
      reportDirectory: '.takt/runs/run-default/reports',
      runSlug: 'run-default',
    });
    const result = findLatestReviewSummary(tmpDir);
    expect(result).toBeNull();
  });

  it('should return null when review run exists but no review-summary.md', () => {
    createRunDir(tmpDir, 'run-review', {
      task: '#42',
      piece: 'review',
      status: 'completed',
      startTime: '2026-01-01T00:00:00.000Z',
      logsDirectory: '.takt/runs/run-review/logs',
      reportDirectory: '.takt/runs/run-review/reports',
      runSlug: 'run-review',
    });
    const result = findLatestReviewSummary(tmpDir);
    expect(result).toBeNull();
  });

  it('should find review-summary.md from latest review run', () => {
    const runDir = createRunDir(tmpDir, 'run-review', {
      task: '#42',
      piece: 'review',
      status: 'completed',
      startTime: '2026-01-01T00:00:00.000Z',
      logsDirectory: '.takt/runs/run-review/logs',
      reportDirectory: '.takt/runs/run-review/reports',
      runSlug: 'run-review',
    });
    writeFileSync(join(runDir, 'reports', 'review-summary.md'), '# APPROVE', 'utf-8');

    const result = findLatestReviewSummary(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.slug).toBe('run-review');
    expect(result!.summaryPath).toContain('review-summary.md');
  });

  it('should find review-summary.md by specific run slug', () => {
    const runDir = createRunDir(tmpDir, 'my-run', {
      task: 'review task',
      piece: 'review',
      status: 'completed',
      startTime: '2026-01-01T00:00:00.000Z',
      logsDirectory: '.takt/runs/my-run/logs',
      reportDirectory: '.takt/runs/my-run/reports',
      runSlug: 'my-run',
    });
    writeFileSync(join(runDir, 'reports', 'review-summary.md'), '# Summary', 'utf-8');

    const result = findLatestReviewSummary(tmpDir, 'my-run');
    expect(result).not.toBeNull();
    expect(result!.slug).toBe('my-run');
  });

  it('should return null for unknown run slug', () => {
    const result = findLatestReviewSummary(tmpDir, 'nonexistent');
    expect(result).toBeNull();
  });

  it('should pick the most recent review run when multiple exist', () => {
    const olderRun = createRunDir(tmpDir, 'run-old', {
      task: '#10',
      piece: 'review',
      status: 'completed',
      startTime: '2026-01-01T00:00:00.000Z',
      logsDirectory: '.takt/runs/run-old/logs',
      reportDirectory: '.takt/runs/run-old/reports',
      runSlug: 'run-old',
    });
    writeFileSync(join(olderRun, 'reports', 'review-summary.md'), '# Old', 'utf-8');

    const newerRun = createRunDir(tmpDir, 'run-new', {
      task: '#20',
      piece: 'review',
      status: 'completed',
      startTime: '2026-02-01T00:00:00.000Z',
      logsDirectory: '.takt/runs/run-new/logs',
      reportDirectory: '.takt/runs/run-new/reports',
      runSlug: 'run-new',
    });
    writeFileSync(join(newerRun, 'reports', 'review-summary.md'), '# New', 'utf-8');

    const result = findLatestReviewSummary(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.slug).toBe('run-new');
  });
});

describe('detectPrNumber', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return PR number when branch has an open PR', () => {
    mockGetCurrentBranch.mockReturnValue('feature/my-branch');
    mockGetGitProvider.mockReturnValue({
      checkCliStatus: vi.fn(),
      fetchIssue: vi.fn(),
      createIssue: vi.fn(),
      findExistingPr: vi.fn().mockReturnValue({ number: 42, url: 'https://github.com/org/repo/pull/42' }),
      createPullRequest: vi.fn(),
      commentOnPr: vi.fn(),
    });

    const result = detectPrNumber('/tmp/test');
    expect(result).toBe(42);
  });

  it('should return undefined when no PR exists for branch', () => {
    mockGetCurrentBranch.mockReturnValue('feature/no-pr');
    mockGetGitProvider.mockReturnValue({
      checkCliStatus: vi.fn(),
      fetchIssue: vi.fn(),
      createIssue: vi.fn(),
      findExistingPr: vi.fn().mockReturnValue(undefined),
      createPullRequest: vi.fn(),
      commentOnPr: vi.fn(),
    });

    const result = detectPrNumber('/tmp/test');
    expect(result).toBeUndefined();
  });

  it('should return undefined when getCurrentBranch throws', () => {
    mockGetCurrentBranch.mockImplementation(() => { throw new Error('not a git repo'); });

    const result = detectPrNumber('/tmp/test');
    expect(result).toBeUndefined();
  });
});

describe('reviewPostCommand', () => {
  let tmpDir: string;
  let mockCommentOnPr: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmpDir = createTmpDir();
    vi.clearAllMocks();
    mockCommentOnPr = vi.fn().mockReturnValue({ success: true });
    mockGetGitProvider.mockReturnValue({
      checkCliStatus: vi.fn(),
      fetchIssue: vi.fn(),
      createIssue: vi.fn(),
      findExistingPr: vi.fn().mockReturnValue({ number: 99, url: 'https://github.com/org/repo/pull/99' }),
      createPullRequest: vi.fn(),
      commentOnPr: mockCommentOnPr,
    });
    mockGetCurrentBranch.mockReturnValue('feature/test');
    process.exitCode = undefined;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it('should set exitCode=1 when no review run found', async () => {
    await reviewPostCommand(tmpDir, {});
    expect(process.exitCode).toBe(1);
  });

  it('should set exitCode=1 when review summary is empty', async () => {
    const runDir = createRunDir(tmpDir, 'run-review', {
      task: '#5',
      piece: 'review',
      status: 'completed',
      startTime: '2026-01-01T00:00:00.000Z',
      logsDirectory: '.takt/runs/run-review/logs',
      reportDirectory: '.takt/runs/run-review/reports',
      runSlug: 'run-review',
    });
    writeFileSync(join(runDir, 'reports', 'review-summary.md'), '', 'utf-8');

    await reviewPostCommand(tmpDir, {});
    expect(process.exitCode).toBe(1);
  });

  it('should set exitCode=1 when PR cannot be detected', async () => {
    const runDir = createRunDir(tmpDir, 'run-review', {
      task: '#5',
      piece: 'review',
      status: 'completed',
      startTime: '2026-01-01T00:00:00.000Z',
      logsDirectory: '.takt/runs/run-review/logs',
      reportDirectory: '.takt/runs/run-review/reports',
      runSlug: 'run-review',
    });
    writeFileSync(join(runDir, 'reports', 'review-summary.md'), '# APPROVE', 'utf-8');

    mockGetCurrentBranch.mockImplementation(() => { throw new Error('not a git repo'); });

    await reviewPostCommand(tmpDir, {});
    expect(process.exitCode).toBe(1);
  });

  it('should post review summary to auto-detected PR', async () => {
    const runDir = createRunDir(tmpDir, 'run-review', {
      task: '#5',
      piece: 'review',
      status: 'completed',
      startTime: '2026-01-01T00:00:00.000Z',
      logsDirectory: '.takt/runs/run-review/logs',
      reportDirectory: '.takt/runs/run-review/reports',
      runSlug: 'run-review',
    });
    writeFileSync(join(runDir, 'reports', 'review-summary.md'), '# APPROVE\nAll good', 'utf-8');

    await reviewPostCommand(tmpDir, {});

    expect(mockCommentOnPr).toHaveBeenCalledWith(tmpDir, 99, '# APPROVE\nAll good');
    expect(process.exitCode).toBeUndefined();
  });

  it('should use explicit --pr number', async () => {
    const runDir = createRunDir(tmpDir, 'run-review', {
      task: '#5',
      piece: 'review',
      status: 'completed',
      startTime: '2026-01-01T00:00:00.000Z',
      logsDirectory: '.takt/runs/run-review/logs',
      reportDirectory: '.takt/runs/run-review/reports',
      runSlug: 'run-review',
    });
    writeFileSync(join(runDir, 'reports', 'review-summary.md'), '# Summary', 'utf-8');

    await reviewPostCommand(tmpDir, { pr: 42 });

    expect(mockCommentOnPr).toHaveBeenCalledWith(tmpDir, 42, '# Summary');
  });

  it('should not post in dry-run mode', async () => {
    const runDir = createRunDir(tmpDir, 'run-review', {
      task: '#5',
      piece: 'review',
      status: 'completed',
      startTime: '2026-01-01T00:00:00.000Z',
      logsDirectory: '.takt/runs/run-review/logs',
      reportDirectory: '.takt/runs/run-review/reports',
      runSlug: 'run-review',
    });
    writeFileSync(join(runDir, 'reports', 'review-summary.md'), '# APPROVE', 'utf-8');

    await reviewPostCommand(tmpDir, { pr: 10, dryRun: true });

    expect(mockCommentOnPr).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('should set exitCode=1 when comment posting fails', async () => {
    const runDir = createRunDir(tmpDir, 'run-review', {
      task: '#5',
      piece: 'review',
      status: 'completed',
      startTime: '2026-01-01T00:00:00.000Z',
      logsDirectory: '.takt/runs/run-review/logs',
      reportDirectory: '.takt/runs/run-review/reports',
      runSlug: 'run-review',
    });
    writeFileSync(join(runDir, 'reports', 'review-summary.md'), '# Summary', 'utf-8');

    mockCommentOnPr.mockReturnValue({ success: false, error: 'HTTP 403' });

    await reviewPostCommand(tmpDir, { pr: 42 });

    expect(process.exitCode).toBe(1);
  });
});
