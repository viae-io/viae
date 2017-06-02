function* foo() {
  yield 1;
  yield 2;
  yield 3;
}

const a = foo();

async function main() {
  for (let item of foo()) {
    console.log(await item);
  }
}

main();