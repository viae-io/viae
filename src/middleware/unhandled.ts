import { Context } from '../context';

export function unhandled() {
  return async (ctx: Context) => {
    throw 404;
  };
}

export function unhandledError() {
  return async (err, ctx: Context) => {

    if (typeof (err) == "number")
      ctx.res.status = err;
    else
      ctx.res.status = 500;

    if (ctx.send != undefined)
      return ctx.send();
  };
}

export function fatalError() {
  return async (err, _) => {
    if (err.stack != undefined) {
      console.log(err);
    }
    return true;
  };
}