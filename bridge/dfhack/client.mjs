// DFHack remote client: protobuf bind + call on top of the raw transport.
//
// DFHack's RPC model: every method must be *bound* first (a call to function id 0 with a
// CoreBindRequest naming the method + its protobuf input/output types + plugin), which returns
// an assigned function id. Subsequent calls use that id. Replies may be interleaved with
// REPLY_TEXT (server debug output) and terminated by REPLY_RESULT or REPLY_FAIL.
//
// Reference: DFHack library/RemoteClient.cpp, plugins/remotefortressreader.
import protobuf from "protobufjs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DFHackConnection, RPC } from "./connection.mjs";

const PROTO_DIR = join(dirname(fileURLToPath(import.meta.url)), "protos");

// Method signatures: DFHack matches these protobuf type names + plugin exactly.
export const METHODS = {
  GetVersionInfo: { input: "dfproto.EmptyMessage", output: "RemoteFortressReader.VersionInfo", plugin: "RemoteFortressReader" },
  GetMapInfo: { input: "dfproto.EmptyMessage", output: "RemoteFortressReader.MapInfo", plugin: "RemoteFortressReader" },
  GetTiletypeList: { input: "dfproto.EmptyMessage", output: "RemoteFortressReader.TiletypeList", plugin: "RemoteFortressReader" },
  GetBlockList: { input: "RemoteFortressReader.BlockRequest", output: "RemoteFortressReader.BlockList", plugin: "RemoteFortressReader" },
  GetUnitList: { input: "dfproto.EmptyMessage", output: "RemoteFortressReader.UnitList", plugin: "RemoteFortressReader" },
  GetViewInfo: { input: "dfproto.EmptyMessage", output: "RemoteFortressReader.ViewInfo", plugin: "RemoteFortressReader" },
  SendDigCommand: { input: "RemoteFortressReader.DigCommand", output: "dfproto.EmptyMessage", plugin: "RemoteFortressReader" },
};

export class DFHackClient {
  constructor(conn, root) {
    this.conn = conn;
    this.root = root;
    this.bound = new Map(); // method name -> { id, input, output }
    this._chain = Promise.resolve(); // serializes RPCs (the socket is request/response)
  }

  static async loadProtos() {
    const root = new protobuf.Root();
    // Resolve every import to our flat protos/ dir by basename.
    root.resolvePath = (_origin, target) => join(PROTO_DIR, basename(target));
    await root.load(
      [join(PROTO_DIR, "CoreProtocol.proto"), join(PROTO_DIR, "RemoteFortressReader.proto")],
      { keepCase: true } // keep snake_case field names matching the .proto
    );
    return root;
  }

  static async connect(opts = {}) {
    const root = await DFHackClient.loadProtos();
    const conn = await DFHackConnection.connect(opts);
    return new DFHackClient(conn, root);
  }

  type(name) {
    return this.root.lookupType(name);
  }

  async bind(method) {
    const sig = METHODS[method];
    if (!sig) throw new Error(`no signature registered for method ${method}`);
    const Req = this.type("dfproto.CoreBindRequest");
    const Rep = this.type("dfproto.CoreBindReply");
    const body = Req.encode(
      Req.create({ method, input_msg: sig.input, output_msg: sig.output, plugin: sig.plugin })
    ).finish();
    this.conn.sendMessage(RPC.BIND_METHOD, body);
    const rep = await this._awaitResult(Rep);
    const info = { id: rep.assigned_id, input: sig.input, output: sig.output };
    this.bound.set(method, info);
    return info;
  }

  // Public call: serialized so a shared client is safe across many callers.
  call(method, request = {}) {
    const task = () => this._invoke(method, request);
    const p = this._chain.then(task, task);
    this._chain = p.then(
      () => {},
      () => {}
    ); // keep the chain alive regardless of this call's outcome
    return p;
  }

  async _invoke(method, request) {
    let info = this.bound.get(method);
    if (!info) info = await this.bind(method);
    const In = this.type(info.input);
    const Out = this.type(info.output);
    const body = In.encode(In.create(request)).finish();
    this.conn.sendMessage(info.id, body);
    return await this._awaitResult(Out);
  }

  // Read frames until RESULT (decode + return) or FAIL (throw), logging TEXT notifications.
  async _awaitResult(OutType) {
    for (;;) {
      const { id, size } = await this.conn.recvHeader();
      if (id === RPC.REPLY_FAIL) {
        // For FAIL, `size` carries the command_result code; there is no body.
        throw new Error(`RPC REPLY_FAIL (code ${size})`);
      }
      const body = await this.conn.readBody(size);
      if (id === RPC.REPLY_RESULT) return OutType.decode(body);
      if (id === RPC.REPLY_TEXT) {
        try {
          const note = this.type("dfproto.CoreTextNotification").decode(body);
          for (const f of note.fragments || []) {
            if (f.text) process.stderr.write(`[df] ${f.text}\n`);
          }
        } catch {
          /* ignore unparseable text */
        }
        continue;
      }
      throw new Error(`unexpected reply id ${id}`);
    }
  }

  quit() {
    this.conn.quit();
  }
}
