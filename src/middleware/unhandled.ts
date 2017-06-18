import { Context, ContextProcessor, ContextHandler } from '../context';

export class Unhandled implements ContextProcessor {

  constructor(private _opts = { debug: true }) {
  }

  /**
  * @internal 
  */
  process(ctx: any, err: any) {
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
            if (this._opts.debug && err instanceof Error) {
              ctx.res.body = err.stack;
            }
          }
        }
        if (ctx.send != undefined) {
          ctx.send();
        }
      }
    }
    return err;
  }
};