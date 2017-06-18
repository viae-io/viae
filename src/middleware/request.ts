import { Context, RequestContext, isRequest } from '../context';

/* the message is a request with a path matching the parameter */
export function request() {
  return (ctx: Context) => {
    return isRequest(ctx);    
  };
}

