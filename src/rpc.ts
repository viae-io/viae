import { Via } from './via';
import { Router } from './middleware/router';
import { Method } from './method';
import { RequestContext } from './context';


export class Rpc {
  static createHost<I>(obj: I, name: string) {
    let router = new Router({ root: "/rpc/" + name });

    for (let key in obj) {
      let entry = obj[key];

      if (typeof entry === "function") {
        let func: Function = entry;
        router.route({
          path: key,
          method: Method.POST,
          handlers: [
            (ctx: RequestContext) => {
              let _args = ctx.req.args;
              let result = func(..._args);
              ctx.send({
                body: result,
                status: 200,
              })
            }
          ]
        })
      }
    }
    return router;
  }
}



