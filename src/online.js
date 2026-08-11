// Free two-device online play via PeerJS (WebRTC over PeerJS's free cloud
// broker). No account, no backend. One player creates a room, the other joins
// with the code. Both race; the first to top out loses.

export class Online2P {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.role = null; // 'host' | 'guest'
    this.roomCode = null;
    this.myName = '';
    this.rivalName = 'RIVAL';
    this.connected = false;
    this._handlers = { open: [], peer: [], message: [], close: [], error: [] };
  }

  supported() {
    return typeof window !== 'undefined' && typeof window.Peer === 'function';
  }

  on(ev, cb) {
    this._handlers[ev].push(cb);
  }

  _emit(ev, data) {
    this._handlers[ev].slice().forEach((cb) => {
      try { cb(data); } catch (e) { console.error('online handler', ev, e); }
    });
  }

  _roomId() {
    const hex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
    return `jemz-${hex()}${hex()}`;
  }

  createRoom(name) {
    if (!this.supported()) return false;
    this.myName = (name || 'P1').toUpperCase().slice(0, 12);
    this.role = 'host';
    this.peer = new window.Peer(this._roomId(), this._peerOpts());
    this.peer.on('open', (id) => {
      this.roomCode = id;
      this._emit('open', { code: id, host: true });
    });
    this.peer.on('connection', (conn) => {
      if (this.conn) { try { conn.close(); } catch (e) {} return; }
      this.conn = conn;
      this._bindConn();
    });
    this.peer.on('error', (err) => this._emit('error', err));
    return true;
  }

  joinRoom(code, name) {
    if (!this.supported()) return false;
    this.myName = (name || 'P2').toUpperCase().slice(0, 12);
    this.role = 'guest';
    code = String(code || '').trim().toLowerCase();
    this.peer = new window.Peer(this._roomId(), this._peerOpts());
    this.peer.on('open', () => {
      this.conn = this.peer.connect(code, { reliable: true });
      this._bindConn();
    });
    this.peer.on('error', (err) => this._emit('error', err));
    return true;
  }

  _peerOpts() {
    return {
      debug: 0,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          {
            urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443'],
            username: 'openrelayproject',
            credential: 'openrelayproject'
          }
        ]
      }
    };
  }

  _bindConn() {
    const conn = this.conn;
    conn.on('open', () => {
      this.connected = true;
      this.send('meta', { name: this.myName });
      this._emit('open', { code: this.roomCode, host: this.role === 'host' });
    });
    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object' || !msg.type) return;
      if (msg.type === 'meta') {
        this.rivalName = msg.data && msg.data.name ? String(msg.data.name).toUpperCase() : 'RIVAL';
        this._emit('peer', this.rivalName);
        return;
      }
      this._emit('message', msg);
    });
    conn.on('close', () => {
      const was = this.connected;
      this.connected = false;
      if (was) this._emit('close');
    });
    conn.on('error', (err) => this._emit('error', err));
  }

  send(type, data) {
    if (!this.conn || !this.connected) return;
    try {
      this.conn.send({ type, data: data === undefined ? null : data });
    } catch (e) { /* connection just closed */ }
  }

  close() {
    this._handlers = { open: [], peer: [], message: [], close: [], error: [] };
    try { if (this.conn) this.conn.close(); } catch (e) {}
    try { if (this.peer) this.peer.destroy(); } catch (e) {}
    this.peer = null;
    this.conn = null;
    this.connected = false;
    this.roomCode = null;
  }
}
