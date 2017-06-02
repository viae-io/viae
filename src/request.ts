import { ViaMessage } from './message';
import { ViaMethod } from './method';

export interface ViaRequest {
  id: string; 
  method: ViaMethod;
  path: string;  
  body?: string | ArrayBuffer | object;
}
