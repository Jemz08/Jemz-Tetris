// Tetromino definitions, SRS rotation system and the 7-bag randomizer.
// Seven standard pieces: I O T S Z J L

export const PIECE_TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

export const COLORS = {
  I: '#06c7d9',
  O: '#f8c30d',
  T: '#ba36ee',
  S: '#4bc607',
  Z: '#e21f1e',
  J: '#1459f6',
  L: '#f07303'
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

// ---- SRS rotation system ------------------------------------------------
// Official Super Rotation System kick tables per the Tetris Guideline.
// Each piece tracks a rotationState (0-3) that determines the actual kick
// offsets rather than just "was it clockwise?".

// JLSTZ rotation states: 0=spawn, 1=CW, 2=180, 3=CCW
// I rotation states:     0=horizontal, 1=CW vertical, 2=horizontal flipped, 3=CCW vertical
const SRS_STATE = {
  I: [0, 1, 2, 3],
  O: [0, 0, 0, 0],
  T: [0, 1, 2, 3],
  S: [0, 1, 2, 3],
  Z: [0, 1, 2, 3],
  J: [0, 1, 2, 3],
  L: [0, 1, 2, 3]
};

// SRS_OFFSETS[piece][rotationState] = [ [CW offsets], [CCW offsets] ]
// Each entry is an array of [dx, dy] offsets to try, with [0,0] first.
// dy > 0 = down (y-down coordinate system used by this board).
const SRS_OFFSETS = {
  JLSTZ: [
    // State 0 (spawn)
    [[[0,0], [-1,0], [-1,+1], [0,-2], [-1,-2]],
     [[0,0], [+1,0], [+1,-1], [0,+2], [+1,+2]]],
    // State 1 (CW)
    [[[0,0], [+1,0], [+1,-1], [0,+2], [+1,+2]],
     [[0,0], [+1,0], [+1,+1], [0,-2], [+1,-2]]],
    // State 2 (180)
    [[[0,0], [+1,0], [+1,+1], [0,-2], [+1,-2]],
     [[0,0], [-1,0], [-1,-1], [0,+2], [-1,+2]]],
    // State 3 (CCW)
    [[[0,0], [-1,0], [-1,+1], [0,-2], [-1,-2]],
     [[0,0], [-1,0], [-1,-1], [0,+2], [-1,+2]]]
  ],
  I: [
    // State 0 (horizontal)
    [[[0,0], [-2,0], [+1,0], [-2,-1], [+1,+2]],
     [[0,0], [-1,0], [+2,0], [-1,+2], [+2,-1]]],
    // State 1 (CW vertical)
    [[[0,0], [-1,0], [+2,0], [-1,+2], [+2,-1]],
     [[0,0], [+2,0], [-1,0], [+2,+1], [-1,-2]]],
    // State 2 (horizontal flipped)
    [[[0,0], [+2,0], [-1,0], [+2,+1], [-1,-2]],
     [[0,0], [+1,0], [-2,0], [+1,-2], [-2,+1]]],
    // State 3 (CCW vertical)
    [[[0,0], [+1,0], [-2,0], [+1,-2], [-2,+1]],
     [[0,0], [-2,0], [+1,0], [-2,-1], [+1,+2]]]
  ],
  O: [
    [[[0,0], [0,0], [0,0], [0,0], [0,0]],
     [[0,0], [0,0], [0,0], [0,0], [0,0]]],
    [[[0,0], [0,0], [0,0], [0,0], [0,0]],
     [[0,0], [0,0], [0,0], [0,0], [0,0]]],
    [[[0,0], [0,0], [0,0], [0,0], [0,0]],
     [[0,0], [0,0], [0,0], [0,0], [0,0]]],
    [[[0,0], [0,0], [0,0], [0,0], [0,0]],
     [[0,0], [0,0], [0,0], [0,0], [0,0]]]
  ]
};

// Get the SRS kick table for a given piece type and rotation.
// dir > 0 = clockwise, dir < 0 = counter-clockwise.
export function getSrsKicks(type, state, dir) {
  const table = type === 'I' ? SRS_OFFSETS.I
    : type === 'O' ? SRS_OFFSETS.O
    : SRS_OFFSETS.JLSTZ;
  const dirIdx = dir > 0 ? 0 : 1;
  return table[state][dirIdx];
}

// Next rotation state after rotating in the given direction.
export function nextRotationState(state, dir) {
  return ((state + (dir > 0 ? 1 : 3)) % 4);
}

export function createPiece(type) {
  return {
    type,
    color: COLORS[type],
    matrix: MATRICES[type].map((row) => row.slice()),
    size: SIZE[type],
    x: 3,
    y: type === 'O' ? 0 : -1,
    rotationState: 0
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
    y: piece.y,
    rotationState: piece.rotationState
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
