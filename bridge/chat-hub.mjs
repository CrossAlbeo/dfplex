// ChatHub: the bridge's cross-connection chat + presence layer.
//
// Each browser connection has its own isolated map/units feed (an RFRSource or a MockSource), so
// nothing in that path ever crosses between players. Chat is the opposite — a line typed by one
// player must reach all of them — so it needs a single object that knows every connected peer.
// That's the hub: it owns nick tracking, join/leave/rename notices, the online roster, and the
// broadcast. It is deliberately transport-agnostic — a peer is registered with a `send(obj)`
// callback, so the bridge wires that to `ws.send(JSON.stringify(...))` while tests pass a plain
// array-push and assert on the captured objects.

import { S2C } from "../client/js/protocol.js";

/** Replace ASCII control chars (and DEL) with spaces — by code point, so the source stays pure ASCII. */
function stripControl(s) {
  let out = "";
  for (const ch of String(s ?? "")) {
    const c = ch.codePointAt(0);
    out += c < 0x20 || c === 0x7f ? " " : ch;
  }
  return out;
}

/** Collapse whitespace, strip control chars, cap length — for display names. */
export function sanitizeNick(nick) {
  return stripControl(nick).replace(/\s+/g, " ").trim().slice(0, 24);
}

/** Strip control chars, collapse whitespace, trim, cap length — for chat bodies. */
export function sanitizeText(text) {
  return stripControl(text).replace(/\s+/g, " ").trim().slice(0, 500);
}

export class ChatHub {
  constructor() {
    this.peers = new Map(); // id -> { id, nick, send }
    this._seq = 0;
  }

  /** Register a connection. `send(obj)` delivers one message to that single client. Returns the peer. */
  add(send) {
    const id = `c${++this._seq}`;
    const peer = { id, nick: null, send };
    this.peers.set(id, peer);
    return peer;
  }

  /** Drop a connection; announce the departure if the peer had ever joined, then refresh the roster. */
  remove(peer) {
    if (!peer || !this.peers.delete(peer.id)) return;
    if (peer.nick) this.system(`${peer.nick} left`);
    this.presence();
  }

  /** Adopt (or change) a peer's nick from a join message; announce join/rename + refresh the roster. */
  join(peer, nick) {
    const clean = sanitizeNick(nick) || `Player-${peer.id}`;
    const prev = peer.nick;
    peer.nick = clean;
    if (!prev) this.system(`${clean} joined`);
    else if (prev !== clean) this.system(`${prev} is now ${clean}`);
    this.presence();
  }

  /** Broadcast a user chat line attributed to `peer`. Empty/whitespace text is ignored. */
  chat(peer, text) {
    const t = sanitizeText(text);
    if (!t) return;
    this.broadcast({ type: S2C.CHAT, kind: "user", from: peer.nick || "?", text: t, ts: Date.now() });
  }

  /** Broadcast a system notice (joins/leaves/renames). */
  system(text) {
    this.broadcast({ type: S2C.CHAT, kind: "system", text, ts: Date.now() });
  }

  /** Broadcast the current roster — only peers that have joined with a nick. */
  presence() {
    const list = [...this.peers.values()].filter((p) => p.nick).map((p) => ({ id: p.id, nick: p.nick }));
    this.broadcast({ type: S2C.PRESENCE, list });
  }

  /** Send a message object to every connected peer; one dead socket can't break the rest. */
  broadcast(msg) {
    for (const p of this.peers.values()) {
      try {
        p.send(msg);
      } catch {
        /* ignore a failed send so the broadcast still reaches the other peers */
      }
    }
  }
}
