import { Intercept } from './intercept';
import { ViaProcessor, ViaContext, ViaHandler } from '../via';
import { MessageStreamFlags } from '../message';
import { Readable } from 'stream';

export class Unhandled implements ViaProcessor {
  /**
  * @internal 
  */
  process(ctx: ViaContext, err: any) {
    if (ctx.req != undefined) {
      if (ctx.res != undefined) {
        if (ctx.res.status == undefined) {
          if (err == undefined) {
            ctx.res.status = 404;
          }
          else if (typeof (err) == "number") {
            ctx.res.status = err;
          }
          else {
            ctx.res.status = 500;
          }
        }
        if (ctx.send != undefined) {
          return ctx.send();
        }
      }
    }
    return err;
  }
};