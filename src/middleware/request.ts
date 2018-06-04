
import * as pathToRegexp from 'path-to-regexp';
import { Context } from '../context';

/* the message is a request with a path matching the parameter */
export function request(method?: string, path?: string) {
  if (method != undefined && path != undefined) {
    let keys = [];
    var exp = pathToRegexp(path, keys);
    return (ctx: Context) => {
      if (ctx.in == undefined || ctx.in.head == undefined || ctx.in.head.method !== method)
        return false;
      let match = (ctx.in.head.path) ? exp.exec(ctx.in.head.path) : null;
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
      return ctx.in != undefined && ctx.in.head != undefined && ctx.in.head.method === method;
    };
  }
  return (ctx: Context) => {
    return ctx.in != undefined;
  };
}