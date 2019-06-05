"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Pb = require("./pb");
const Pbf = require("pbf");
class FrameEncoder {
    constructor() {
        this._pool = new Uint8Array(1024 * 1024);
    }
    encode(frame) {
        const pbf = new Pbf(this._pool);
        Pb.Msg.write(frame, pbf);
        const view = pbf.finish();
        const dst = new Uint8Array(view.length);
        dst.set(view);
        return dst;
    }
    decode(buffer) {
        const pbf = new Pbf(buffer);
        return Pb.Msg.read(pbf);
    }
}
exports.FrameEncoder = FrameEncoder;
