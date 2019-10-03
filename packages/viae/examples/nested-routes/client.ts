import { Via } from '../../src';
import * as WebSocket from 'ws';

let wire = new WebSocket("ws://0.0.0.0:8080");
let via = new Via({ wire });

via.on("open", async () => {
  console.log(await via.call("GET", "foo"));
  console.log(await via.call("GET", "foo/bar"));
  console.log(await via.call("GET", "foo/bar/123"));
  console.log(await via.call("GET", "foo/bar/123/ray"));
 
  wire.close();
});

via.on("error", (err) => {
  console.log(err);
});