
function main() {
  let methods = [];
  for (let i = 0; i < 10; i++) {
    methods.push(() => { console.log(i) });
  }
  return methods;
}


let foo = main();

for(let item of foo){
  item();
}