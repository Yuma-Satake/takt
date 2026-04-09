/**
 * Tests for completion menu rendering and terminal output
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import chalk from 'chalk';
import {
  renderCompletionMenu,
  writeCompletionMenu,
  clearCompletionMenu,
  type CompletionCandidate,
} from '../features/interactive/completionMenu.js';
import { stripAnsi, getDisplayWidth } from '../shared/utils/text.js';

const ENGLISH_CANDIDATES: readonly CompletionCandidate[] = [
  { value: '/play', description: 'Run a task immediately', applyValue: '/play ' },
  { value: '/go', description: 'Create instruction & run', applyValue: '/go ' },
  { value: '/retry', description: 'Review & rerun with previous instructions', applyValue: '/retry ' },
];

const JAPANESE_CANDIDATES: readonly CompletionCandidate[] = [
  { value: '/play', description: 'タスクを即実行する', applyValue: '/play ' },
];

describe('renderCompletionMenu', () => {
  it('should return separator + one line per candidate', () => {
    const lines = renderCompletionMenu(ENGLISH_CANDIDATES, 0, 80);
    expect(lines.length).toBe(ENGLISH_CANDIDATES.length + 1);
  });

  it('should include command name in each line', () => {
    const lines = renderCompletionMenu(ENGLISH_CANDIDATES, 0, 80);
    const stripped = lines.map(stripAnsi);
    expect(stripped[1]).toContain('/play');
    expect(stripped[2]).toContain('/go');
  });

  it('should include description in each line', () => {
    const lines = renderCompletionMenu([ENGLISH_CANDIDATES[0]!], 0, 80);
    const stripped = lines.map(stripAnsi);
    expect(stripped[1]).toContain('Run a task immediately');
  });

  it('should include Japanese description when provided', () => {
    const lines = renderCompletionMenu(JAPANESE_CANDIDATES, 0, 80);
    const stripped = lines.map(stripAnsi);
    expect(stripped[1]).toContain('タスクを即実行する');
  });

  it('should render separator as first line', () => {
    const lines = renderCompletionMenu(ENGLISH_CANDIDATES, 0, 80);
    const stripped = stripAnsi(lines[0]!);
    expect(stripped).toMatch(/^─+$/);
    expect(stripped.length).toBe(80);
  });

  it('should handle empty candidates', () => {
    const lines = renderCompletionMenu([], 0, 80);
    expect(lines.length).toBe(1);
  });

  it('should handle narrow terminal width', () => {
    const lines = renderCompletionMenu([ENGLISH_CANDIDATES[0]!], 0, 30);
    expect(lines.length).toBe(2);
  });

  it('should always include all candidate commands regardless of selectedIndex', () => {
    const lines0 = renderCompletionMenu(ENGLISH_CANDIDATES, 0, 80).map(stripAnsi);
    const lines2 = renderCompletionMenu(ENGLISH_CANDIDATES, 2, 80).map(stripAnsi);
    expect(lines0[1]).toContain('/play');
    expect(lines2[1]).toContain('/play');
    expect(lines0[3]).toContain('/retry');
    expect(lines2[3]).toContain('/retry');
  });

  it('should omit description when terminal width is very narrow', () => {
    const lines = renderCompletionMenu([ENGLISH_CANDIDATES[0]!], 0, 14);
    const stripped = stripAnsi(lines[1]!);
    expect(stripped).toContain('/play');
    expect(stripped).not.toContain('Run a task');
  });

  it.each([20, 26, 30, 40])('should not exceed termWidth=%i for English candidates', (termWidth) => {
    const lines = renderCompletionMenu(ENGLISH_CANDIDATES, 0, termWidth);
    for (const line of lines) {
      const width = getDisplayWidth(stripAnsi(line));
      expect(width).toBeLessThanOrEqual(termWidth);
    }
  });

  it.each([20, 26, 30, 40])('should not exceed termWidth=%i for Japanese candidates', (termWidth) => {
    const lines = renderCompletionMenu(JAPANESE_CANDIDATES, 0, termWidth);
    for (const line of lines) {
      const width = getDisplayWidth(stripAnsi(line));
      expect(width).toBeLessThanOrEqual(termWidth);
    }
  });

  describe('selection highlighting (raw ANSI)', () => {
    // These tests intentionally do NOT strip ANSI so that a regression in
    // the selected-row styling (e.g. removing cyan/bold) would fail here.
    // Force chalk to emit SGR codes regardless of the test runner's TTY state.
    let savedChalkLevel: (typeof chalk)['level'];
    beforeAll(() => {
      savedChalkLevel = chalk.level;
      chalk.level = 3;
    });
    afterAll(() => {
      chalk.level = savedChalkLevel;
    });

    const SGR_BOLD = '\x1B[1m';
    const SGR_CYAN = '\x1B[36m';
    const SGR_GRAY = '\x1B[90m';
    const SGR_DIM = '\x1B[2m';

    it('should emphasize the selected row with cyan + bold SGR codes', () => {
      const lines = renderCompletionMenu(ENGLISH_CANDIDATES, 1, 80);
      const selected = lines[2]!; // separator + /play + /go (selected)
      expect(selected).toContain(SGR_CYAN);
      expect(selected).toContain(SGR_BOLD);
      expect(selected).toContain('/go');
    });

    it('should render unselected rows without cyan + bold SGR codes', () => {
      const lines = renderCompletionMenu(ENGLISH_CANDIDATES, 1, 80);
      const unselected = lines[1]!; // /play (unselected because selectedIndex = 1)
      expect(unselected).not.toContain(SGR_CYAN);
      expect(unselected).not.toContain(SGR_BOLD);
      // unselected command text is styled with gray; description is dim
      expect(unselected).toContain(SGR_GRAY);
      expect(unselected).toContain(SGR_DIM);
    });

    it('should shift emphasis when selectedIndex changes', () => {
      const withFirstSelected = renderCompletionMenu(ENGLISH_CANDIDATES, 0, 80);
      const withLastSelected = renderCompletionMenu(ENGLISH_CANDIDATES, 2, 80);
      // First rendering: row 1 is emphasized, row 3 is not
      expect(withFirstSelected[1]!).toContain(SGR_CYAN);
      expect(withFirstSelected[3]!).not.toContain(SGR_CYAN);
      // Last rendering: row 3 is emphasized, row 1 is not
      expect(withLastSelected[1]!).not.toContain(SGR_CYAN);
      expect(withLastSelected[3]!).toContain(SGR_CYAN);
    });
  });
});

// --- writeCompletionMenu / clearCompletionMenu terminal output tests ---

describe('writeCompletionMenu', () => {
  let savedWrite: typeof process.stdout.write;
  let writtenData: string[];

  beforeEach(() => {
    savedWrite = process.stdout.write;
    writtenData = [];
    process.stdout.write = vi.fn((data: string | Uint8Array) => {
      writtenData.push(typeof data === 'string' ? data : data.toString());
      return true;
    }) as unknown as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = savedWrite;
  });

  it('should write menu lines to stdout', () => {
    const lines = ['separator', 'item1', 'item2'];
    writeCompletionMenu(lines, 0);
    const output = writtenData.join('');
    expect(output).toContain('separator\nitem1\nitem2');
  });

  it('should move cursor down when rowsBelowCursor > 0', () => {
    writeCompletionMenu(['line'], 3);
    expect(writtenData[0]).toBe('\x1B[3B');
  });

  it('should erase below and restore cursor position', () => {
    writeCompletionMenu(['line'], 0);
    const output = writtenData.join('');
    expect(output).toContain('\x1B[J');
    expect(output).toContain('\x1B[1A');
  });

  it('should restore cursor by total lines when multiple lines written', () => {
    writeCompletionMenu(['sep', 'item1', 'item2', 'item3'], 0);
    const output = writtenData.join('');
    expect(output).toContain('\x1B[4A');
  });

  it('should restore cursor by lines + rowsBelowCursor combined', () => {
    writeCompletionMenu(['sep', 'item1', 'item2'], 2);
    const output = writtenData.join('');
    expect(output).toContain('\x1B[2B');
    expect(output).toContain('\x1B[5A');
  });
});

describe('clearCompletionMenu', () => {
  let savedWrite: typeof process.stdout.write;
  let writtenData: string[];

  beforeEach(() => {
    savedWrite = process.stdout.write;
    writtenData = [];
    process.stdout.write = vi.fn((data: string | Uint8Array) => {
      writtenData.push(typeof data === 'string' ? data : data.toString());
      return true;
    }) as unknown as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = savedWrite;
  });

  it('should erase below cursor', () => {
    clearCompletionMenu(0);
    const output = writtenData.join('');
    expect(output).toContain('\x1B[J');
  });

  it('should move cursor down when rowsBelowCursor > 0', () => {
    clearCompletionMenu(2);
    expect(writtenData[0]).toBe('\x1B[2B');
  });

  it('should restore cursor after clearing', () => {
    clearCompletionMenu(0);
    const output = writtenData.join('');
    expect(output).toContain('\x1B[1A');
  });

  it('should move up by rowsBelowCursor + 1 when clearing', () => {
    clearCompletionMenu(2);
    const output = writtenData.join('');
    expect(output).toContain('\x1B[3A');
  });
});
