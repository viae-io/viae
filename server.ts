import { Server as WebSocketServer } from 'ws';
import { Viae, RequestContext, Method, Router, Subscription, Subscriber } from './src';
import { Scribe, Itable, unhandled } from './src';
import { Rpc } from './src/rpc';

let wss = new WebSocketServer({ port: 9090 });
let server = new Viae(wss, new Scribe(), new Itable());


let rpc = {
  greet(name: string) {
    return "hello" + name;
  }
};

server.use(Rpc.createHost(rpc, ""));
server.use(unhandled());

console.log("Server Running on 9090....");

