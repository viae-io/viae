const  {Observable, interval} = require('rxjs');
const  {take} = require('rxjs/operators');

const obs = Observable.create($obs => {
  const timer = interval(300)   
    .subscribe(
      val => $obs.next(val),
      err => $obs.error(err),
      () => $obs.complete()
    );

  return function(){
    timer.unsubscribe();    
    console.log("foobar")} // empty unsubscribe function, internal subscription will keep on running
});

obs.pipe(take(4)).subscribe(i => console.log('outer-emission:'+i))