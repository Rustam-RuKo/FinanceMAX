import { z } from 'zod';
import { db } from './db';
import { hashPassword, management } from './auth';
import { ensure } from './errors';
import type { Principal } from '../domain/authorization';
import type { Tx } from './calculation-data';
const roles=z.enum(['ADMIN_MANAGEMENT','PARTNER','EMPLOYEE']);
const login=z.string().trim().toLowerCase().email('Введите корректный логин');
export function validatePassword(password:string,confirm:string,email:string){
 ensure(password.length>=10&&password.length<=256,'Пароль должен содержать от 10 до 256 символов');
 ensure(password===confirm,'Пароли не совпадают');
 ensure(password.toLowerCase()!==email.toLowerCase(),'Пароль не должен совпадать с логином');
}
export async function securityAudit(tx:Tx,actor:string,target:string,action:string,values:Record<string,string|boolean>={}){
 await tx.auditLog.create({data:{entity:'User',entityId:target,operation:action,newValue:values,createdBy:actor}});
}
export async function manageUser(user:Principal,operation:string,raw:Record<string,unknown>){
 management(user);
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(734821)`;
  const actor=await tx.user.findUnique({where:{id:user.id}});
  ensure(actor?.active&&actor.role==='ADMIN_MANAGEMENT','Недостаточно прав',403);
  if(operation==='user'){
   const p=z.object({name:z.string().trim().min(1,'Укажите ФИО'),email:login,password:z.string(),confirmPassword:z.string(),role:roles,employeeId:z.string().uuid().optional(),partnerId:z.string().uuid().optional()}).parse(raw);
   validatePassword(p.password,p.confirmPassword,p.email);
   ensure(!await tx.user.findUnique({where:{email:p.email}}),'Такой логин уже используется',409);
   ensure(!(p.employeeId&&p.role!=='EMPLOYEE')&&!(p.partnerId&&p.role!=='PARTNER'),'Связь не соответствует роли');
   const row=await tx.user.create({data:{name:p.name,email:p.email,role:p.role,passwordHash:await hashPassword(p.password),demo:false}});
   if(p.role==='EMPLOYEE'){
    if(p.employeeId){ensure(await tx.employee.findFirst({where:{id:p.employeeId,userId:null,archived:false}}),'Сотрудник уже связан или архивирован');await tx.employee.update({where:{id:p.employeeId},data:{userId:row.id,updatedBy:user.id}});}
    else await tx.employee.create({data:{name:p.name,userId:row.id,createdBy:user.id}});
   }
   if(p.role==='PARTNER'){
    if(p.partnerId){ensure(await tx.partner.findFirst({where:{id:p.partnerId,userId:null,archived:false}}),'Партнер уже связан или архивирован');await tx.partner.update({where:{id:p.partnerId},data:{userId:row.id,updatedBy:user.id}});}
    else await tx.partner.create({data:{name:p.name,userId:row.id,createdBy:user.id}});
   }
   await securityAudit(tx,user.id,row.id,'USER_CREATED',{name:p.name,login:p.email,role:p.role});return{id:row.id};
  }
  const targetId=z.string().uuid('Выберите пользователя').parse(raw.id);
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${targetId}::uuid FOR UPDATE`;
  const target=await tx.user.findUniqueOrThrow({where:{id:targetId}});
  if(operation==='user-password'){
   const p=z.object({password:z.string(),confirmPassword:z.string()}).parse(raw);validatePassword(p.password,p.confirmPassword,target.email);
   await tx.user.update({where:{id:targetId},data:{passwordHash:await hashPassword(p.password),failedLogins:0,lockedUntil:null}});
   await tx.session.deleteMany({where:{userId:targetId}});
   await securityAudit(tx,user.id,targetId,'PASSWORD_RESET_BY_ADMIN');return{id:targetId};
  }
  ensure(operation==='user-update','Неизвестная операция',404);
  const p=z.object({email:login,role:roles,active:z.boolean()}).parse(raw);
  ensure(!await tx.user.findFirst({where:{email:p.email,id:{not:targetId}}}),'Такой логин уже используется',409);
  if(target.active&&target.role==='ADMIN_MANAGEMENT'&&(!p.active||p.role!=='ADMIN_MANAGEMENT'))ensure(await tx.user.count({where:{active:true,role:'ADMIN_MANAGEMENT',id:{not:targetId}}})>0,'Нельзя отключить последнего руководителя');
  const employee=await tx.employee.findUnique({where:{userId:targetId}}),partner=await tx.partner.findUnique({where:{userId:targetId}});
  ensure(!employee||p.role==='EMPLOYEE','Роль связанного сотрудника нельзя изменить без согласованного переноса связи');
  ensure(!partner||p.role==='PARTNER','Роль связанного партнера нельзя изменить без согласованного переноса связи');
  if(p.role==='EMPLOYEE'&&!employee)await tx.employee.create({data:{name:target.name,userId:targetId,createdBy:user.id}});
  if(p.role==='PARTNER'&&!partner)await tx.partner.create({data:{name:target.name,userId:targetId,createdBy:user.id}});
  await tx.user.update({where:{id:targetId},data:p});
  if(p.email!==target.email)await securityAudit(tx,user.id,targetId,'LOGIN_CHANGED',{oldLogin:target.email,newLogin:p.email});
  if(p.role!==target.role)await securityAudit(tx,user.id,targetId,'ROLE_CHANGED',{oldRole:target.role,newRole:p.role});
  if(p.active!==target.active)await securityAudit(tx,user.id,targetId,p.active?'USER_ACTIVATED':'USER_DEACTIVATED');
  if(!p.active||p.role!==target.role||p.email!==target.email)await tx.session.deleteMany({where:{userId:targetId}});
  return{id:targetId};
 },{isolationLevel:'Serializable',timeout:30000});
}
