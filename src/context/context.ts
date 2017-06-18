import { BaseContext } from 'rowan';
import { Via } from '../via';

export interface Context extends BaseContext {
  id: string;
  connection: Via;
  $done?: true;
}