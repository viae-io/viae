import { ViaStatus } from './status';

export interface ViaResponse {  
  id: string;
  status: ViaStatus;
  body?: string | Uint8Array | object | 
}
