import { ViaePlugin } from '../viae-plugin';
import { Viae } from '../viae';
import { Method } from '../method';

export function scribe() {
  return {
    plugin(viae: Viae) {
      viae.before((ctx) => {
        ctx["$start"] = process.hrtime();
      });
      viae.after((ctx) => {
        if (ctx.req === undefined) return;

        let start = ctx["$start"];

        let method = ctx.req.method;
        let path = ctx.req.path;
        let status = ctx.res.status;

        let hrtime = process.hrtime(ctx["$start"]);
        let span = hrtime[1] / 1000000;

        console.log(Method[method], path, status, span + "ms" );
      });
    }
  }
};