"use client";
import { useEffect, useState, type FormEvent } from 'react';
type Role='ADMIN_MANAGEMENT'|'EMPLOYEE'|'PARTNER';
type Account={id:string;name:string;email:string;role:Role;active:boolean};
const roleNames={ADMIN_MANAGEMENT:'Руководство',EMPLOYEE:'Сотрудник',PARTNER:'Партнер'};
export function UserManagement({defaultRole='EMPLOYEE',compact=false}:{defaultRole?:Role;compact?:boolean}){
 const [users,setUsers]=useState<Account[]>([]),[target,setTarget]=useState<Account|null>(null),[mode,setMode]=useState<'create'|'edit'|'password'|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 async function load(){const r=await fetch('/api/v1/users',{cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error?.message??'Ошибка загрузки');setUsers(data.items);}
 useEffect(()=>{if(!compact)load().catch(e=>setMessage(e.message));},[compact]);
 function open(next:typeof mode,row:Account|null=null){setTarget(row);setMode(next);setMessage('');}
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget;const f=new FormData(form);setBusy(true);setMessage('');
 const data:Record<string,unknown>={};for(const [k,v]of f)data[k]=String(v);
 if(target)data.id=target.id;
 if(mode==='edit')data.active=f.has('active');
 try{const response=await fetch('/api/v1/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:mode==='create'?'user':mode==='password'?'user-password':'user-update',requestId:crypto.randomUUID(),data})});
 const result=await response.json();if(!response.ok)throw Error(result.error?.message??'Не удалось сохранить');form.reset();setMode(null);setMessage(mode==='password'?'Пароль успешно изменён':mode==='create'?'Учетная запись создана':'Учетная запись изменена');if(!compact && mode!=='password')await load();
 }catch(e){setMessage(e instanceof Error?e.message:'Ошибка сохранения');}finally{data.password=undefined;data.confirmPassword=undefined;for(const n of ['password','confirmPassword']){const input=form.elements.namedItem(n);if(input instanceof HTMLInputElement)input.value='';}setBusy(false);}}
 return <section aria-label="Учетные записи">
 {!compact&&<h2>Учетные записи</h2>}
 <button onClick={()=>open('create')}>{compact?`Создать учетную запись ${defaultRole==='PARTNER'?'партнера':'сотрудника'}`:'Создать учетную запись'}</button>
 <p role="status">{message}</p>
 {!compact&&<table><thead><tr><th>ФИО</th><th>Логин</th><th>Роль</th><th>Статус</th><th>Действия</th></tr></thead><tbody>{users.map(row=><tr key={row.id}><td>{row.name}</td><td>{row.email}</td><td>{roleNames[row.role]}</td><td>{row.active?'Активна':'Неактивна'}</td><td><button onClick={()=>open('edit',row)}>Изменить учетную запись</button><button onClick={()=>open('password',row)}>Изменить пароль</button></td></tr>)}</tbody></table>}
 {mode&&<form key={`${mode}-${target?.id??'new'}`} onSubmit={submit} aria-label={mode==='password'?'Изменить пароль':'Учетная запись'}>
 <h3>{mode==='password'?`Изменить пароль: ${target?.name}`:mode==='create'?'Новая учетная запись':target?.name}</h3>
 {mode==='create'&&<label>ФИО<input name="name" required maxLength={200}/></label>}
 {mode!=='password'&&<><label>Логин<input name="email" type="email" required defaultValue={target?.email} placeholder="firstname.lastname@financemax.local" autoComplete="off"/></label><label>Роль<select name="role" defaultValue={target?.role??defaultRole}>{Object.entries(roleNames).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></>}
 {mode!=='edit'&&<><p>Минимум 10 символов. Рекомендуем 12 и более.</p><label>{mode==='password'?'Новый пароль':'Пароль'}<input type="password" name="password" required minLength={10} maxLength={256} autoComplete="new-password"/></label><label>Повторите пароль<input type="password" name="confirmPassword" required minLength={10} maxLength={256} autoComplete="new-password"/></label></>}
 {mode==='edit'&&<label><input type="checkbox" name="active" defaultChecked={target?.active}/>Учетная запись активна</label>}
 {mode==='create'&&<p>Для роли «Сотрудник» или «Партнер» будет создана связанная запись с указанным ФИО.</p>}
 <button disabled={busy} type="submit">{busy?'Сохранение…':'Сохранить'}</button><button type="button" onClick={()=>setMode(null)} disabled={busy}>Отмена</button>
 </form>}
 </section>;
}

