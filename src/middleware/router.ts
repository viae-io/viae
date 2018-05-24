

import { Rowan, If, Processor } from 'rowan';
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

export class Router extends Rowan<Context> implements RouterOptions {
  /** route base path  */
  root: string = "/";
  /** route descriptive name */
  name: string;
  /** route documentation */
  doc: string;

  constructor(opts?: RouterOptions) {
    super();

    Object.assign(this, opts);

    if (/:/.test(this.root)) {
      throw Error("parameters within root path are not supported");
    }

    this.root = this.root.trim();

    if (this.root.startsWith("/") == false) {
      this.root = "/" + this.root;
    }
    if (this.root.endsWith("/") == true) {
      this.root = this.root.substr(0, this.root.length - 1);
    }
  }

  route(opts: {
    path: string,
    method: string,
    process: Processor<Context>[]
    name?: string,
    doc?: string
  }) {
    this.use(new If(request(opts.method, normalise(this.root, opts.path)), opts.process));
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

/* the message is a request with a path matching the parameter */
export function request(method?: string, path?: string) {
  if (method != undefined && path != undefined) {
    let keys = [];
    var exp = pathToRegexp(path, keys);
    return (ctx: Context) => {
      if (ctx.req == undefined || ctx.req.head == undefined || ctx.req.head.method !== method)
        return false;
      let match = (ctx.req.head.path) ? exp.exec(ctx.req.head.path) : null;
      if (match == null) {
        return false;
      }
      if (keys.length > 0) {
        ctx.params = ctx.params || {};
        for (let i = 0; i < keys.length; i += 1) {
          ctx.params[keys[i].name] = match[i + 1];
        }
      }
      return true;
    };
  }
  else if (method != undefined) {
    return (ctx: Context) => {
      return ctx.req != undefined && ctx.req.head != undefined && ctx.req.head.method === method;
    };
  }
  return (ctx: Context) => {
    return ctx.req != undefined;
  };
}