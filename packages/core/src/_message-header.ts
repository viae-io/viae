import { Status } from "./status";

/** message header */
export interface MessageHeader {
  /* request: resource path */
  path?: string;
  /* request: method */
  method?: string;
  /* response: status code */
  status?: Status;
  /* encoding used on body */
  encoding?: string;

  [index: string]: any;
}

