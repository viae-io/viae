import { Rowan } from "rowan";
import { Router } from "./middleware";

export class App extends Rowan {
  constructor(opts: { controllers: any[] }) {
    super();
    let { controllers } = opts;
    for (let controller of controllers) {
      let router = routerFactory(controller);
      if (router) {
        this.use(router);
      }
    }
  }
}

function routerFactory(controller) {
  const routerOpts = Reflect.getMetadata("__router", controller);

  if (!routerOpts) return;

  const router = new Router(routerOpts);
  const routesOpts = routerOpts.routes;
  if (routesOpts) {
    for (let routeKey in routesOpts) {
      const route = routesOpts[routeKey];
      const routeArgs = route.args;

      let path = route["path"];
      let method = route["method"];
      let func = controller[routeKey].bind(controller);

      router.route({
        path: path,
        method: method,
        process: [
          async function (ctx) {
            ctx.out = {
              id: ctx.in.id,
              head: { status: 200 },
            };
            let args = routeArgs.map(x => {
              switch (x.type) {
                case "data":
                  return ctx.in.data;
                case "ctx":
                  return ctx;
                case "param":
                  return ctx.params[x.opt];
              };
              return undefined;
            });

            try {
              let result = await func(...args);
              if (result) {
                ctx.out.data = result;
              }
            } catch (err) {
              if (typeof err == "number") {
                ctx.out.head.status = err;
              } else {
                throw err;
              }
            }
          }]
      });
    }
  }
  return router;
}