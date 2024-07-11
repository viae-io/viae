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
  console.log("connections: " + viae.connections.length);
  console.log("active ctx: " + viae.connections.map(x=>x.active.length).reduce((p, c)=>p+c, 0))
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
  path: "/", handler(opt) {
    return Status.OK
  },
})


viae.use(api);