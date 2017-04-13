import { Wire } from './wire';
import { ViaRequest} from './request';
import { ViaMessage } from './message';
import { ViaStatus } from './status';

export interface ViaContext {
  wire: Wire;
  req: ViaRequest;
  res: ViaMessage;

  begin();
  send(body?: string | Uint8Array | Object, done?:boolean);
  sendStatus(status: ViaStatus, body?: string | Uint8Array | Object);
  end(body?: string | Uint8Array | Object);

  _done?: true;
}
