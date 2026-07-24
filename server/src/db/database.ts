import {Database} from 'bun:sqlite';import {dirname} from 'node:path';import {mkdirSync} from 'node:fs';import {migrate} from './schema';
export function openDb(path:string){mkdirSync(dirname(path),{recursive:true});const db=new Database(path);migrate(db);db.exec('PRAGMA journal_mode=WAL');db.exec('PRAGMA synchronous=NORMAL');return db;}
export function tx<T>(db:Database,fn:()=>T):T{db.exec('BEGIN');try{const v=fn();db.exec('COMMIT');return v}catch(e){db.exec('ROLLBACK');throw e}}
export const now=()=>new Date().toISOString();export const id=()=>crypto.randomUUID();
