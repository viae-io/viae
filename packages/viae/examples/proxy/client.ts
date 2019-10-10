import { Via, Controller, All } from '../../src';
import * as WebSocket from 'ws';
import { isObservable, Observable, from, interval } from 'rxjs';
import { tap, mergeAll, take, map } from 'rxjs/operators';
import { App, Data } from '../../dist';

let wire = new WebSocket("ws://0.0.0.0:8080");
let via = new Via({ wire });

@Controller()
class ServiceController {
  @All("*")
  greet(@Data() ops: Observable<number>) {
    return ops.pipe(map(x=>x*2))
  }
}

via.use(new App({ controllers: [new ServiceController()] }));

via.on("open", async () => {

  let result = await via.call<Observable<number>>("GET", "/info", from([1,2,3,4]), { validate: isObservable })

  await result.pipe(tap(console.log)).toPromise();

  wire.close();
});

via.on("error", (err) => {
  console.log(err);
});