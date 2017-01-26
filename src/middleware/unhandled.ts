import { ViaContext } from '../context';

export function unhandled() {
  return async (ctx: ViaContext) => {
    throw 404;
  };
}

export function unhandledError() {
  return async (ctx: ViaContext, err: any) => {

    if (typeof (err) == "number")
      ctx.res.status = err;
    else
      ctx.res.status = 500;

    if (ctx.send != undefined)
      return ctx.send();
  };
}

export function fatalError() {
  return async (_, err) => {
    if (err.stack != undefined) {
      console.log(err);
    }
    return true;
  };
}