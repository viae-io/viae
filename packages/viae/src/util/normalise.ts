export function normalisePath(...join: string[]) {
  let path =  "/";
  for(let next of join){
    if(typeof (next) != "string" || next.length <= 0){
      continue;
    }
    if(path.endsWith("/") == false){
      path += "/";
    }

    path += next;
  }

  return path.replace(/[\/]{2,}/g, "/");
}