import { Viae } from '../viae';
import { ResponseContext } from '../context';
import { Method } from '../method';
import { Request } from '../request';

export interface ScribePostContext extends ResponseContext {
  /* start time (hrtime) */
  $start: [number, number];
  $span: number;

  /* the request header */
  req?: Request;
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
      ctx["$span"] = end[1] /1000000;

      this.log(ctx);
    });
  }
}


