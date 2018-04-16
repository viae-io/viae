import { Context, RequestContext, isResponse } from '../context';

/* the message is a request with a path matching the parameter */
export function response() {
  return (ctx: Context) => {
    return isResponse(ctx);    
  };
}

