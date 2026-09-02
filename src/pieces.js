// Tetromino definitions, rotation and the 7-bag randomizer.
// Seven standard pieces: I O T S Z J L

export const PIECE_TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

export const PIECE_COLORS = {
  I: {
    base: '#00f0ff', light: '#80f8ff', dark: '#008899',
    glow: 'rgba(0,240,255,0.5)', inner: 'rgba(0,240,255,0.15)', shine: 'rgba(200,255,255,0.7)'
  },
  O: {
    base: '#ffd740', light: '#ffe880', dark: '#b39500',
    glow: 'rgba(255,215,64,0.5)', inner: 'rgba(255,215,64,0.15)', shine: 'rgba(255,245,200,0.7)'
  },
  T: {
    base: '#e040fb', light: '#f080ff', dark: '#9c27b0',
    glow: 'rgba(224,64,251,0.5)', inner: 'rgba(224,64,251,0.15)', shine: 'rgba(255,200,255,0.7)'
  },
  S: {
    base: '#00e676', light: '#69f0ae', dark: '#00a152',
    glow: 'rgba(0,230,118,0.5)', inner: 'rgba(0,230,118,0.15)', shine: 'rgba(200,255,230,0.7)'
  },
  Z: {
    base: '#ff1744', light: '#ff616f', dark: '#c4001d',
    glow: 'rgba(255,23,68,0.5)', inner: 'rgba(255,23,68,0.15)', shine: 'rgba(255,200,210,0.7)'
  },
  J: {
    base: '#448aff', light: '#82b1ff', dark: '#2962ff',
    glow: 'rgba(68,138,255,0.5)', inner: 'rgba(68,138,255,0.15)', shine: 'rgba(200,220,255,0.7)'
  },
  L: {
    base: '#ff9100', light: '#ffb74d', dark: '#c56200',
    glow: 'rgba(255,145,0,0.5)', inner: 'rgba(255,145,0,0.15)', shine: 'rgba(255,230,200,0.7)'
  }
};

// Backward-compatible flat color map
export const COLORS = {};
for (const [k, v] of Object.entries(PIECE_COLORS)) COLORS[k] = v.base;

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

export const KICKS_JLSTZ = [
  [0, 0], [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
  [-2, 0], [2, 0]
];
export const KICKS_I = [
  [0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0],
  [0, -1], [0, 1], [-1, -1], [1, -1], [-2, -1], [2, -1]
];

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
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        out[x][size - 1 - y] = matrix[y][x];
      }
    }
  } else {
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
