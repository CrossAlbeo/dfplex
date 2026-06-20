// Unit test for the bridge chat hub (bridge/chat-hub.mjs): sanitizers behave, and a line/join/
// leave from one peer reaches every connected peer with the right shape + an updated roster.
// Peers are plain capturing functions, so this runs headless. Usage: node bridge/test/chat-hub.mjs
import { ChatHub, sanitizeNick, sanitizeText } from "../chat-hub.mjs";
import { S2C } from "../../client/js/protocol.js";

let fail = 0;
const ok = (c, m) => (c ? console.log("  ok  -", m) : (console.error("  FAIL-", m), fail++));
const last = (inbox, type) => [...inbox].reverse().find((m) => m.type === type);

// --- sanitizers (control chars built via fromCharCode so the test source stays pure ASCII) ---
const TAB = String.fromCharCode(9);
const NL = String.fromCharCode(10);
const NUL = String.fromCharCode(0);
ok(sanitizeNick("  Urist   McMiner  ") === "Urist McMiner", "nick: trims + collapses whitespace");
ok(sanitizeNick("x".repeat(40)).length === 24, "nick: capped at 24 chars");
ok(sanitizeNick(null) === "" && sanitizeNick(undefined) === "", "nick: nullish -> empty");
ok(sanitizeNick("a" + TAB + "b" + NL + "c") === "a b c", "nick: control chars become spaces");
ok(sanitizeText("  hello  world  ") === "hello world", "text: trims + collapses");
ok(sanitizeText("a" + NUL + "bc") === "a bc", "text: NUL/control chars become spaces");
ok(sanitizeText("   ") === "", "text: all-whitespace -> empty");
ok(sanitizeText("y".repeat(600)).length === 500, "text: capped at 500 chars");

// --- hub: two connected peers, capturing every delivered message ---
const hub = new ChatHub();
const a = [];
const b = [];
const pa = hub.add((m) => a.push(m));
const pb = hub.add((m) => b.push(m));
ok(pa.id !== pb.id, "peers get distinct ids");

// A joins -> both peers see a "joined" system line and a 1-entry roster.
hub.join(pa, "Alice");
ok(/Alice joined/.test(last(b, S2C.CHAT)?.text || ""), "join: others get the joined notice");
ok(last(b, S2C.CHAT)?.kind === "system", "join notice is kind=system");
ok(last(b, S2C.PRESENCE)?.list.length === 1, "presence after one join lists 1");

// B joins -> roster now lists both, in join order.
hub.join(pb, "Bob");
const roster = last(a, S2C.PRESENCE)?.list.map((p) => p.nick);
ok(JSON.stringify(roster) === JSON.stringify(["Alice", "Bob"]), `presence lists both (${roster})`);

// A chats -> B receives a user line attributed to Alice.
hub.chat(pa, "dig the stairs");
const cm = last(b, S2C.CHAT);
ok(cm?.kind === "user" && cm.from === "Alice" && cm.text === "dig the stairs", "chat: delivered + attributed");

// Empty chat is ignored (no new message reaches B).
const beforeEmpty = b.length;
hub.chat(pa, "   ");
ok(b.length === beforeEmpty, "chat: whitespace-only is dropped");

// Rename via a second join announces the change.
hub.join(pa, "Alyce");
ok(/Alice is now Alyce/.test(last(b, S2C.CHAT)?.text || ""), "join again: announces rename");

// B leaves -> A gets a "left" notice and a roster back down to 1.
hub.remove(pb);
ok(/Bob left/.test(last(a, S2C.CHAT)?.text || ""), "leave: others get the left notice");
ok(last(a, S2C.PRESENCE)?.list.length === 1, "presence after leave lists 1");

// A peer that never joined contributes no roster entry.
const c = [];
const pc = hub.add((m) => c.push(m));
hub.presence();
ok(last(c, S2C.PRESENCE)?.list.every((p) => p.nick), "presence excludes peers without a nick");
ok(pc.nick === null, "un-joined peer has no nick");

console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
