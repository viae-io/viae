

import { Rowan, If, Processor, IRowan, Middleware, Next } from 'rowan';
import { Context } from '../context';
import * as pathToRegexp from 'path-to-regexp';


export interface RouterOptions {
  /** route root path */
  root?: string;
  /** route descriptive name */
  name?: string;
  /** route documentation */
  doc?: string;
};

export class Router implements Middleware<Context>, RouterOptions {

  /** route base path  */
  root: string;
  /** route descriptive name */
  name: string;
  /** route documentation */
  doc: string;

  middleware: Middleware<Context>[] = [];

  private _rootMatch: (ctx: Context) => string;

  constructor(opts?: RouterOptions) {
    Object.assign(this, opts);



    this.root = this.root.trim();

    if (this.root.startsWith("/") == false) {
      this.root = "/" + this.root;
    }
    if (this.root.endsWith("/") == true) {
      this.root = this.root.substr(0, this.root.length - 1);
    }

    const keys = [];
    const exp = pathToRegexp(this.root, keys, {
      strict: false,
      end: false
    });

    this._rootMatch = (ctx) => {
      let match = (ctx.in.head.path) ? exp.exec(ctx.in.head.path) : null;
      if (match == null) {
        return;
      }
      if (keys.length > 0) {
        ctx.params = ctx.params || {};
        for (let i = 0; i < keys.length; i += 1) {
          ctx.params[keys[i].name] = match[i + 1];
        }
      }
      return match[0];
    }
  }

  process(ctx: Context, next: Next): Promise<void> {
    let match = this._rootMatch(ctx);
    if (match) {
      let originalPath = ctx.in.head.path;
      ctx.in.head.path = originalPath.substr(match.length);
      return Rowan.process(this.middleware, ctx, function () {
        ctx.in.head.path = originalPath;
        return next()
      });
    }
    return next();
  }

  private use(proc: Processor<Context>) {
    this.middleware.push(Rowan.convertToMiddleware(proc));
  }

  route(opts: {
    path: string,
    method: string,
    process: Processor<Context>[]
    name?: string,
    doc?: string,
    end?: boolean;
  }) {
    if (opts.path.startsWith("/") == false) {
      opts.path = "/" + opts.path;
    }
    if (opts.path.endsWith("/") == true) {
      opts.path = opts.path.substr(0, opts.path.length - 1);
    }
    const path = opts.path;
    const keys = [];
    const exp = pathToRegexp(path, keys, {
      strict: false,
      end: (opts.end !== undefined) ? opts.end : true
    });
    const method = opts.method;
    const processors = opts.process.map(x => Rowan.convertToMiddleware(x));

    this.use(
      function (ctx, next): Promise<void> {
        if (ctx.in == undefined || ctx.in.head == undefined)
          return next();

        if (method && ctx.in.head.method !== method)
          return next();

        let match = null;

        if (path == ctx.in.head.path) {
          match = [path];
        }
        else {
          match = (ctx.in.head.path) ? exp.exec(ctx.in.head.path) : null;
          if (match == null) {
            return next();
          }
          if (keys.length > 0) {
            ctx.params = ctx.params || {};
            for (let i = 0; i < keys.length; i += 1) {
              ctx.params[keys[i].name] = match[i + 1];
            }
          }
        }
        if (match == null) {
          return next();
        }

        let originalPath = ctx.in.head.path;
        ctx.in.head.path = originalPath.substr(match[0].length);
        return Rowan.process(processors, ctx, function () {
          ctx.in.head.path = originalPath;
          return next()
        });
      });
  }

  static fromController(controller: Object) {
    const routerOpts = Reflect.getMetadata("__router", controller);

    if (!routerOpts) return undefined;

    const router = new Router(routerOpts);
    const routesOpts = routerOpts.routes;
    if (routesOpts) {
      for (let routeKey in routesOpts) {
        const route = routesOpts[routeKey];
        const routeArgs = route.args || [];

        let path = route["path"];
        let method = route["method"];
        let opts = route["opts"];
        let func = controller[routeKey].bind(controller);

        router.route({
          path: path,
          method: method,
          end: opts.end,
          process: [
            async function (ctx, next) {
              let args = routeArgs.map(x => {
                switch (x.type) {
                  case "data":
                    return ctx.in.data;
                  case "head":
                    return ctx.in.head;
                  case "raw":
                    return ctx.in.raw;
                  case "ctx":
                    return ctx;
                  case "next":
                    return next;
                  case "param":
                    return x.opt ? ctx.params[x.opt] : ctx.params
                };
                return undefined;
              });

              try {
                let result = await func(...args);
                if (result) {
                  ctx.out.head.status = 200;
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
}

function normalise(root: string, path: string) {
  if (path.startsWith("./") == true) {
    path = path.substr(1);
  } else if (path.startsWith("/") == false) {
    path = "/" + path;
  }
  return root + path;
}
