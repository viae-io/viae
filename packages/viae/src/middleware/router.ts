

import { Rowan, Processor, Middleware, Next } from 'rowan';
import { Context } from '../context';
import { ViaeError } from '../error';
import * as pathToRegexp from 'path-to-regexp';
import { normalisePath } from '../util/normalise';

export interface RouterOptions {
  /** route root path */
  root?: string;
  /** route descriptive name */
  name?: string;
  /** route documentation */
  doc?: string;

  middleware?: Middleware<Context>[];
};



export class Router implements Middleware<Context>, RouterOptions {
  /** route base path  */
  root: string;
  /** route descriptive name */
  name: string;
  /** route documentation */
  doc: string;
  /** route middleware */
  middleware: Middleware<Context>[] = [];

  private _rootMatch: (ctx: Context) => string;

  constructor(opts?: RouterOptions) {

    this.root = opts.root || "";
    this.middleware = opts.middleware || [];

    this.root = normalisePath(this.root);

    if(this.root == ""){
      this._rootMatch = ()=>"";
      return;
    }

    const keys = [];
    const exp = pathToRegexp(this.root, keys, {
      strict: false,
      end: false,
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
    };
  }

  process(ctx: Context, next: Next): Promise<void> {
    let match = this._rootMatch(ctx);

    if (match != undefined) {
      let originalPath = ctx.in.head.path;

      if (ctx.in.head.fullPath === undefined) {
        ctx.in.head.fullPath = originalPath;
      }

      ctx.in.head.path = normalisePath(originalPath.substr(match.length));

      return Rowan.process(this.middleware, ctx, function () {
        ctx.in.head.path = originalPath;
        return next();
      }).then(() => { ctx.in.head.path = originalPath; })
        .catch((err) => { ctx.in.head.path = originalPath; throw err; });
    }
    return next();
  }

  private use(processor: Processor<Context>) {
    this.middleware.push(Rowan.convertToMiddleware(processor));
  }

  route(opts: {
    path: string,
    method: string,
    process: Processor<Context>[]
    name?: string,
    doc?: string,
    end?: boolean;
  }) {
    const path = normalisePath(opts.path);
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
          return next();
        }).then(() => { ctx.in.head.path = originalPath; })
          .catch((err) => {
            ctx.in.head.path = originalPath;
            throw err;
          });
      });
  }

  static fromController(controller: Object, root?: string) {
    //Careful not to edit this
    const routerOpts = Reflect.getMetadata("__router", controller);

    if (!routerOpts) return undefined;

    let opts = Object.assign({}, routerOpts);
    
    opts.root = normalisePath(root, opts.root);

    const router = new Router(opts);
    const routesOpts = opts.routes;
    if (routesOpts) {
      for (let routeKey in routesOpts) {
        const route = routesOpts[routeKey];
        const routeArgs = route.args || [];

        let path = route["path"];
        let method = route["method"];
        let opts = route["opts"];
        let func = controller[routeKey].bind(controller);
        let hasNext = routeArgs.find(x=>x.type == "next") !== undefined;

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
                    return x.opt ? new x.ctor(ctx.params[x.opt]).valueOf() : ctx.params;
                };
                return undefined;
              });

              try {
                let result = await func(...args);

                if(result !== undefined) {
                  ctx.out.data = result;
                }

                if (typeof result == "number") {
                  ctx.out.head.status = result;
                } else if(hasNext == false) {
                  ctx.out.head.status = 200;
                }
                //else leave the status as is.                 
              } catch (err) {
                if (typeof err == "number") {
                  ctx.out.head.status = err;
                }
                else if (err instanceof ViaeError) {
                  ctx.out.head.status = err.status;
                  ctx.out.data = err.message;
                }
                else {
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