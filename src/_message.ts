/**
 * the raw message frame for viae
 * it contains four field: id, state, encoding and raw data
 */
export interface IFrame {
  id: string;
  encoding: string;
  raw: Uint8Array;
}

function encodeFrame(frame:IFrame){
  
}


export interface IMessage<T = any> extends IFrame {
  data: T;
}

let frame: IFrame = {
  id: "h",
  encoding: "json",
  raw: new Uint8Array(1)
};