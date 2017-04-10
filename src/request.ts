import { ViaMessage } from './message';

export interface ViaRequest extends ViaMessage {
  params?: any;
}