import { Viae } from '../viae';
import { Context } from '../context';
import { Method } from '../method';
import { Request } from '../request';

export interface ScribePostContext extends Context {
  /* start time (hrtime) */
  $start: [number, number];

  /* milliseconds taken to process */
  $span: number;

  /* the request  */
  req?: Request;

  /* the response */
  res?: Response;

  /* the path parameters extracted from the request */
  params?: any;
}

export class Scribe {
  constructor(private log =
    function (ctx: ScribePostContext) {
      if (ctx.req == undefined) return;

      let method = ctx.req.method;
      let path = ctx.req.path;
      let status = ctx.res.status;
      let span = ctx.$span;

      console.log(Method[method], path, status, span + "ms");
    }) {
  }

  plugin(viae: Viae) {
    viae.before((ctx) => {
      ctx["$start"] = process.hrtime();
    });
    viae.after((ctx) => {
      let start = ctx["$start"];
      let end = process.hrtime(ctx["$start"]);
      ctx["$span"] = end[0] * 1000 + end[1] / 1000000;

      this.log(ctx);
    });
  }
}
