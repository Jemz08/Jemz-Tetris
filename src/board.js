// Board model: 10 x 20 grid, collision, line clearing, lock-flash animation.

export const COLS = 10;
export const ROWS = 20;
// Rows above the visible area that spawn pieces into.
export const HIDDEN = 2;

export class Board {
  constructor() {
    this.reset();
  }

  reset() {
    this.grid = Array.from({ length: ROWS + HIDDEN }, () => new Array(COLS).fill(0));
    this.clearing = []; // rows currently flashing before removal
    this.flash = 0;
    this.gameOver = false;
  }

  cell(y, x) {
    return this.grid[y][x];
  }

  // Is the piece matrix at (x, y) colliding with walls or locked cells?
  collides(matrix, x, y) {
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix[r].length; c++) {
        if (!matrix[r][c]) continue;
        const px = x + c;
        const py = y + r;
        if (px < 0 || px >= COLS || py >= ROWS + HIDDEN) return true;
        if (py >= 0 && this.grid[py][px]) return true;
      }
    }
    return false;
  }

  merge(piece) {
    const { matrix, x, y, color } = piece;
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix[r].length; c++) {
        if (!matrix[r][c]) continue;
        const px = x + c;
        const py = y + r;
        if (py < 0) {
          // locked above the visible board = game over
          this.gameOver = true;
          continue;
        }
        if (py < ROWS + HIDDEN) this.grid[py][px] = color;
      }
    }
    if (this.gameOver) return [];
    return this.findFullRows();
  }

  findFullRows() {
    const rows = [];
    for (let y = ROWS + HIDDEN - 1; y >= 0; y--) {
      if (this.grid[y].every((v) => v !== 0)) rows.push(y);
    }
    return rows;
  }

  // Begin the clear animation for the given rows.
  startClearing(rows) {
    this.clearing = rows.slice();
    this.flash = 180; // ms
  }

  // Remove flashing rows once the animation completes. Returns true if cleared.
  finishClearing() {
    if (!this.clearing.length) return false;
    for (const y of this.clearing) {
      this.grid.splice(y, 1);
      this.grid.unshift(new Array(COLS).fill(0));
    }
    this.clearing = [];
    this.flash = 0;
    return true;
  }

  // A cell is "visually full" if locked or flashing.
  visualCell(y, x) {
    return this.grid[y][x];
  }

  isClearing() {
    return this.clearing.length > 0;
  }

  isRowFlashing(y) {
    return this.clearing.includes(y);
  }

  // Snapshot used for online sync.
  snapshot() {
    const lines = [];
    for (let y = 0; y < ROWS; y++) {
      let row = '';
      for (let x = 0; x < COLS; x++) {
        row += this.grid[y + HIDDEN] ? (this.grid[y + HIDDEN][x] ? '1' : '0') : '0';
      }
      lines.push(row);
    }
    return lines.join('');
  }
}
