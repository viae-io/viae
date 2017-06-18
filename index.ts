function* generator() {
  yield undefined
  yield undefined;
  yield new Promise(r => setTimeout(r, 1000));
  yield 10;
}


async function coroutine(generator) {
  let result;
  for (let task of generator()) {
    result = await task;
  }
  return result;
}

async function main() {
  console.log(await coroutine(generator));
}

main();
