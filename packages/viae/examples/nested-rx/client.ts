import { Via } from '../../src';
import * as WebSocket from 'ws';
import { isObservable, of, Subject, Observable, ReplaySubject, from } from 'rxjs';
import { join } from 'path';
import { mergeAll, tap } from 'rxjs/operators';

let wire = new WebSocket("ws://0.0.0.0:8080", { perMessageDeflate: false });
let via = new Via({ wire: wire as any });

let source = from([from(["a", "b", "c"]), from(["d", "e", "f"])]);

via.on("open", async () => {  
  let result = await via.request("POST", "/echo", source);
  let data = result.data;

  if(isObservable<any>(data)){
     await data.pipe(mergeAll(), tap(x=>console.log(x))).toPromise();
  }
  wire.close();
});

via.on("error", (err) => {
  console.log(err);
});