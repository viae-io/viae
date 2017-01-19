import { Method } from './method';
import { Status } from './status';
import { bytesToHex } from './utils/utils';

/* Streaming Flags */ 
export enum MessageFlags{
  None = 0, // Not Streaming
  Begin = 1,
  Next = 2,
  End = 4,     
}

export interface Message {
  id?: string; //8-byte short-uid (as hex)
  method?: Method;
  path?: string;
  status?: Status;
  headers?: {};
  body?: any;
  flags?: MessageFlags;
}

export namespace Message {
  /* a simple id good enough for small servers */
  export var genId = function () {
    var time = Date.now();
    var numbers = new Array(8);

    numbers[0] = Math.round(Math.random() * 255);
    numbers[1] = Math.round(Math.random() * 255);
    numbers[2] = Math.round(Math.random() * 255);
    numbers[3] = Math.round(Math.random() * 255);

    numbers[4] = (time >> 0) & 0xFF;
    numbers[5] = (time >> 8) & 0xFF;
    numbers[6] = Math.round(Math.random() * ((time >> 16) & 0xFF));
    numbers[7] = Math.round(Math.random() * ((time >> 24) & 0xFF));

    return numbers;
  };
  export var genIdString = function () {
    let id = genId();
    return bytesToHex(genId());
  };
}
