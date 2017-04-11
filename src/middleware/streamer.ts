import { Intercept } from './intercept';
import { ViaProcessor, ViaContext, ViaHandler } from '../via';
import { ViaMessageStreamFlags } from '../message';
import { Readable } from 'stream';

export class Streamer implements ViaProcessor {

  constructor(private _interceptor?: Intercept){
  }

  /**
  * @internal 
  */
  process(ctx: ViaContext, err: any) {
    if (!err) {
      if (ctx.res != undefined &&
        ctx.res.flags !== undefined &&
        ctx.res.flags == ViaMessageStreamFlags.Begin &&
        ctx.res.body !== undefined &&
        typeof (ctx.res.body) == "string"
      ) {
        const sid = ctx.res.body;
        const stream = ctx.res.body = new Readable({ objectMode: true, read: function () { } });
        const dispose = this._interceptor.intercept(sid, [(ctx2: ViaContext) => {
          if (ctx2.res === undefined) {
            dispose();
            stream.emit("error");
            stream.push(null);
          }
          if (ctx2.res != undefined && ctx2.res.body! + undefined) {
            stream.push(ctx2.res.body);
          }
          if (ctx2.res.flags == ViaMessageStreamFlags.End) {
            dispose();
            stream.push(null);
          }
          return false; // terminate 
        }]);
      }
    };
  };
}