import { Api, Viae, } from '../../src';
import { Server as WebSocketServer } from 'ws';
import { Status } from '@viae/core';

let server = new WebSocketServer({
  port: 8080,
  host: "0.0.0.0",
  perMessageDeflate: false
});

let viae = new Viae(server);
let op = 0;

setInterval(() => {
  console.log(`${op} tps`);
  op = 0;
}, 1000);

viae.before((ctx, next) => {
  op += 1;
  return next!();
});

class EchoController {
  echo() {
    return Status.OK;
  }
}

const api = new Api();

api.get({
  path: "/echo", 
  accept: "object",
  validate(value): asserts value is string {
    if (typeof value != "string") throw Error("value is not a string");
  },
  handler(opt) {
    return opt.data
  },
})

viae.use(api);