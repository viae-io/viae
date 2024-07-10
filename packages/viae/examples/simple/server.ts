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
  handler(opt) {
    return opt.data;
  },
})

viae.use(api);