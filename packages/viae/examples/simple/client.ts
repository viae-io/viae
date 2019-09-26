import { Via } from '../../src';
import * as WebSocket from 'ws';
import { isObservable, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

let wire = new WebSocket("ws://0.0.0.0:8080");
let via = new Via({ wire });

via.on("open", async () => {
  let result = await via.call<Observable<number>>("GET", "/info", undefined, {validate: isObservable})

  await result.pipe(tap(console.log)).toPromise();

  wire.close();
});

via.on("error", (err) => {
  console.log(err);
});