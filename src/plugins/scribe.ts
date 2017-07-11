import { Viae } from '../viae';
import { ResponseContext } from '../context';
import { Method } from '../method';
import { Request } from '../request';

import now = require('performance-now');

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
      ctx["$start"] = now();
    });
    viae.after((ctx) => {
      let start = ctx["$start"];
      let end = now() - start;
      ctx["$span"] = end;

      this.log(ctx);
    });
  }
}


