import {IUser} from './user';

export interface IComment {
  user: IUser | null;
  body?: string;
  created_at?: string;
}
