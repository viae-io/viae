import { MessageHeader } from "./_message-header";

/**
 * message
 */
export interface MessageFrame {
  /* required: id */
  id: string;
  /* header */
  head?: MessageHeader;
  /* raw data payload */
  raw?: Uint8Array;
}