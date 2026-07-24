export class HttpError extends Error{constructor(public status:number,message:string){super(message)}}
export async function json(req:Request){try{return await req.json()}catch{throw new HttpError(400,'Invalid JSON')}}
export function str(v:unknown,name:string,opts:{required?:boolean;max?:number}={}){if(v==null||v===''){if(opts.required)throw new HttpError(400,`${name} is required`);return ''}if(typeof v!=='string')throw new HttpError(400,`${name} must be a string`);if(opts.max&&v.length>opts.max)throw new HttpError(400,`${name} is too long`);return v}
export function bool(v:unknown){return v===true||v===1||v==='1'}
export function num(v:unknown,d:number){const n=Number(v??d);if(!Number.isFinite(n))throw new HttpError(400,'Invalid number');return n}
export function ok(data:unknown,status=200){return Response.json(data,{status})}
export function fail(e:unknown){if(e instanceof HttpError)return ok({error:e.message},e.status);console.error(e);return ok({error:'Internal server error'},500)}
