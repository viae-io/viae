import { Context, isRequest } from '../context';
import { Method } from '../method';
import * as pathToRegexp from 'path-to-regexp';

export type PathRequest = string | RegExp | (string | RegExp)[];

/* the message is a request with a path matching the parameter */
export function request(method?: Method, path?: string) {
  if (method != undefined && path != undefined) {
    let keys = [];
    var exp = pathToRegexp(path, keys);
    return (ctx: Context) => {
      if (ctx.req == undefined || ctx.req.method !== method)
        return false;
      let match = (ctx.req.path) ? exp.exec(ctx.req.path) : null;
      if (match == null) {
        return false;
      }
      if (keys.length > 0) {
        ctx.params = ctx.params || {};
        for (let i = 0; i < keys.length; i += 1) {
          ctx.params[keys[i].name] = match[i + 1];
        }
      }
    };
  }
  else if (method != undefined) {
    return (ctx: Context) => {
      return ctx.req != undefined && ctx.req.method === method;
    };
  }
  return (ctx: Context) => {
    return ctx.req != undefined;
  };
}

