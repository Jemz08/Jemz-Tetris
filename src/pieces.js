// Tetromino definitions, rotation and the 7-bag randomizer.
// Seven standard pieces: I O T S Z J L

export const PIECE_TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

export const COLORS = {
  I: '#00f0ff',
  O: '#ffd447',
  T: '#d142f5',
  S: '#35e07a',
  Z: '#ff3b5c',
  J: '#4d7cff',
  L: '#ff9a3d'
};

// Matrices are row-major. Pieces spawn at the top-middle of the board.
const MATRICES = {
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ],
  O: [
    [1, 1],
    [1, 1]
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0]
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0]
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0]
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0]
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0]
  ]
};

const SIZE = { I: 4, O: 2, T: 3, S: 3, Z: 3, J: 3, L: 3 };

export function createPiece(type) {
  return {
    type,
    color: COLORS[type],
    matrix: MATRICES[type].map((row) => row.slice()),
    size: SIZE[type],
    x: 3,
    y: type === 'O' ? 0 : -1
  };
}

export function rotateMatrix(matrix, dir) {
  const size = matrix.length;
  const out = matrix.map((row) => row.slice());
  if (dir > 0) {
    // clockwise: transpose then reverse rows
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        out[x][size - 1 - y] = matrix[y][x];
      }
    }
  } else {
    // counter-clockwise: transpose then reverse columns
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        out[size - 1 - x][y] = matrix[y][x];
      }
    }
  }
  return out;
}

export function clonePiece(piece) {
  return {
    type: piece.type,
    color: piece.color,
    matrix: piece.matrix.map((r) => r.slice()),
    size: piece.size,
    x: piece.x,
    y: piece.y
  };
}

// ---- 7-bag randomizer ------------------------------------------------

export class BagRandomizer {
  constructor() {
    this.bag = [];
  }

  next() {
    if (this.bag.length === 0) {
      this.bag = PIECE_TYPES.slice();
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = this.bag[i];
        this.bag[i] = this.bag[j];
        this.bag[j] = tmp;
      }
    }
    return this.bag.pop();
  }
}
