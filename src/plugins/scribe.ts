import { Viae } from '../viae';
import { RequestContext } from '../context';
import { Method } from '../method';

export type ScribeContext = RequestContext & {
  $start: number;
  $span: number;
}

export class Scribe {
  constructor(private log =
    function (ctx: ScribeContext) {
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
      let hrtime = process.hrtime(ctx["$start"]);
      ctx["$span"] = hrtime[1] / 1000000;

      this.log(ctx);
    });
  }
}


