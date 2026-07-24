import {expect,test} from 'bun:test';import {Database} from 'bun:sqlite';import {migrate} from '../src/db/schema';import {Repo} from '../src/db/repo';
function repo(){const db=new Database(':memory:');migrate(db);return new Repo(db)}
test('schema persists conversation related records and flush preserves descriptions',()=>{const r=repo();const c:any=r.createConversation('t');const a:any=r.createAgent(c.id,{name:'Bot',introduction:'desc'});const m:any=r.addMessage(c.id,{role:'user',speaker_type:'profile',speaker_name_snapshot:'User',content:'hi'});const te:any=r.toolEvent(c.id,{tool_call_id:'call1',tool_name:'generateRandomNumber',state:'succeeded',arguments:{min:1,max:2},result:{value:1}});r.addAttachment(c.id,{message_id:m.id,tool_event_id:te.id,type:'image',mime_type:'image/png',filename:'x.png',public_url:'/assets/images/x.png'});expect(r.agents(c.id).length).toBe(1);expect(r.profiles(c.id).length).toBe(1);expect(r.messages(c.id).length).toBe(2);r.flush(c.id);const msgs:any[]=r.messages(c.id) as any[];expect(msgs.length).toBe(1);expect(msgs[0].kind).toBe('character_description');expect(a.name).toBe('Bot')});
test('agents support an independent kokoro_voice alongside the piper voice', () => {
  const r = repo();
  const c: any = r.createConversation('k');
  const a: any = r.createAgent(c.id, { name: 'Bot', voice: 'en_GB-alan-medium', kokoro_voice: 'af_heart' });
  expect(a.voice).toBe('en_GB-alan-medium');
  expect(a.kokoro_voice).toBe('af_heart');

  const updated: any = r.patchAgent(c.id, a.id, { kokoro_voice: 'if_sara' });
  expect(updated.kokoro_voice).toBe('if_sara');
  expect(updated.voice).toBe('en_GB-alan-medium');
});
