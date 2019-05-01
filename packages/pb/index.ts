import { MessageFrame } from "@viae/core";
import Pb = require('./pb');
import Pbf = require('pbf');

export class FrameEncoder {
  private _pool = new Uint8Array(1024 * 1024);

  constructor() {
  }

  encode (frame: MessageFrame){
    const pbf = new Pbf(this._pool);
    Pb.Msg.write(frame, pbf);        
    const view = pbf.finish();
    const dst = new Uint8Array(view.length);
    dst.set(view);
    return dst;
  }

  decode(buffer: Uint8Array): MessageFrame {
    const pbf = new Pbf(buffer);
    return Pb.Msg.read(pbf);
  }
}