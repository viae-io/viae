import { RequestContext, ContextProcessor } from '../context';

export function unhandled() {
  return {
    process(ctx: RequestContext, err: any) {
      if (ctx.req != undefined && typeof ctx.send === "function") {
        let status = 404;
        let body = undefined;
        if (typeof err === "number") {
          status = err;
        }
        else if (err instanceof Error) {
          status = 500;
          body = err.message;
        }
        ctx.send({ body: body, status: status });
        
        return true; // clear the error
      }
      return err;
    }
  };
}