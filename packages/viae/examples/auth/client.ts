import { Via } from '../../src';
import * as WebSocket from 'ws';
import { isObservable, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

let wire = new WebSocket("ws://0.0.0.0:8080");
let via = new Via({ wire });

via.on("open", async () => {
  try{
  console.log(await via.call("GET", "foo"));
  }catch(err){
    console.log(err);
  }

  await via.call("POST", "foo/auth", "foo");

  console.log(await via.call("GET", "foo"));
 
  wire.close();
});

via.on("error", (err) => {
  console.log(err);
});