/**
 * Completion menu state management and operations.
 *
 * Manages the lifecycle of the inline completion menu:
 * filtering candidates, selection navigation, applying completions,
 * and coordinating with the terminal renderer.
 *
 * Separated from lineEditor to keep input handling and completion
 * logic as distinct concerns.
 */

import {
  renderCompletionMenu,
  writeCompletionMenu,
  clearCompletionMenu,
  type CompletionCandidate,
} from './completionMenu.js';

interface CompletionState {
  readonly candidates: readonly CompletionCandidate[];
  selectedIndex: number;
}

export interface CompletionController {
  readonly getState: () => CompletionState | null;
  readonly update: () => void;
  readonly hide: () => void;
  readonly moveSelection: (delta: number) => void;
  readonly apply: () => void;
}

/**
 * Create a completion controller bound to a line editor instance.
 */
export const createCompletionController = (
  accessors: {
    getBuffer: () => string;
    getCursorPos: () => number;
    getTermWidth: () => number;
    getTerminalColumn: (pos: number) => number;
    countRowsAboveCursor: () => number;
    countRowsBelowCursor: () => number;
  },
  mutators: {
    setBuffer: (value: string) => void;
    setCursorPos: (value: number) => void;
  },
  promptWidth: number,
  completionProvider?: (context: { buffer: string }) => readonly CompletionCandidate[],
): CompletionController => {
  let completionState: CompletionState | null = null;

  /**
   * Render current completionState to the terminal and restore cursor column.
   */
  const redraw = (): void => {
    if (!completionState) return;
    const termWidth = accessors.getTermWidth();
    const rowsBelow = accessors.countRowsBelowCursor();
    const lines = renderCompletionMenu(completionState.candidates, completionState.selectedIndex, termWidth);
    const termCol = accessors.getTerminalColumn(accessors.getCursorPos());
    writeCompletionMenu(lines, rowsBelow);
    process.stdout.write(`\x1B[${termCol}G`);
  };

  /**
   * Hide the completion menu if visible.
   */
  const hide = (): void => {
    if (!completionState) return;
    const rowsBelow = accessors.countRowsBelowCursor();
    const termCol = accessors.getTerminalColumn(accessors.getCursorPos());
    clearCompletionMenu(rowsBelow);
    process.stdout.write(`\x1B[${termCol}G`);
    completionState = null;
  };

  /**
   * Update completion menu state based on current buffer.
   */
  const update = (): void => {
    if (!completionProvider) {
      hide();
      return;
    }

    const buffer = accessors.getBuffer();
    const candidates = completionProvider({ buffer });

    if (candidates.length === 0) {
      hide();
      return;
    }

    const selectedIndex = completionState
      ? Math.min(completionState.selectedIndex, candidates.length - 1)
      : 0;
    completionState = { candidates, selectedIndex };

    redraw();
  };

  /**
   * Move completion selection by delta (+1 = down, -1 = up) with wrap-around.
   */
  const moveSelection = (delta: number): void => {
    if (!completionState || completionState.candidates.length === 0) return;
    const len = completionState.candidates.length;
    completionState.selectedIndex = ((completionState.selectedIndex + delta) % len + len) % len;
    redraw();
  };

  /**
   * Apply the selected completion value to the buffer.
   *
   * Correctly returns the cursor to the first display row of the prompt
   * even when the previous buffer had soft-wrapped onto multiple rows,
   * then clears everything below before repainting the new buffer.
   */
  const apply = (): void => {
    if (!completionState) return;
    const selected = completionState.candidates[completionState.selectedIndex];
    if (!selected) return;

    const newBuffer = selected.applyValue ?? selected.value;
    const rowsAbove = accessors.countRowsAboveCursor();
    const rowsBelow = accessors.countRowsBelowCursor();

    // Remove the completion menu drawn below the input.
    clearCompletionMenu(rowsBelow);

    // Walk back up to the first display row of the buffer (the prompt row).
    if (rowsAbove > 0) {
      process.stdout.write(`\x1B[${rowsAbove}A`);
    }
    // Return to column 1 then step past the prompt.
    process.stdout.write('\r');
    if (promptWidth > 0) {
      process.stdout.write(`\x1B[${promptWidth}C`);
    }
    // Clear everything from the cursor to the end of the screen so stale
    // wrapped buffer content does not remain visible.
    process.stdout.write('\x1B[J');

    mutators.setBuffer(newBuffer);
    mutators.setCursorPos(newBuffer.length);
    process.stdout.write(newBuffer);

    completionState = null;
  };

  return {
    getState: () => completionState,
    update,
    hide,
    moveSelection,
    apply,
  };
};
