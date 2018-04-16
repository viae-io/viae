/**
 * a frame is the raw message frame for viae
 * it contains four fields, id, state, encoder and data
 */
export default interface IFrame {
  id: string;
  state: string;
  encoder: number;
  data: Uint8Array;
}