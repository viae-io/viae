function * foo(){
  yield 1;
  yield 2;
  yield 3;
}

const a = foo();

console.log(a.next());

const b = a[Symbol.iterator]();

console.log(b.next());