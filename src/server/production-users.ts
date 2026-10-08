import { randomInt } from 'node:crypto';
import { hashPassword } from './auth';
import { ensure } from './errors';
import { securityAudit } from './user-management';
import type { Tx } from './calculation-data';
export const productionIdentities=[
 ['Собир Сафаев','sobir@financemax.local','ADMIN_MANAGEMENT'],['Атабек Нурматов','atabek@financemax.local','ADMIN_MANAGEMENT'],['Катерина','katerina@financemax.local','ADMIN_MANAGEMENT'],['Карина Григорьянц','karina@financemax.local','PARTNER'],['Акилбек Ишев','akilbek@financemax.local','PARTNER'],
] as const;
export function generateInitialPassword(){
 const groups=['ABCDEFGHJKLMNPQRSTUVWXYZ','abcdefghijkmnopqrstuvwxyz','23456789','!@#$%&*+-=?'];const alphabet=groups.join('');const chars=groups.map(g=>g[randomInt(g.length)]);while(chars.length<24)chars.push(alphabet[randomInt(alphabet.length)]);for(let i=chars.length-1;i>0;i--){const j=randomInt(i+1);[chars[i],chars[j]]=[chars[j],chars[i]];}return chars.join('');
}
export async function bootstrapProductionUsers(tx:Tx,expectedIds:Record<string,string>){
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(734821)`;
 ensure(!await tx.auditLog.findFirst({where:{operation:'PRODUCTION_USERS_BOOTSTRAPPED'}}),'Production user bootstrap уже выполнен.',409);
 const users=await tx.user.findMany();ensure(users.length===5,'Ожидалось ровно пять пользователей');
 for(const [name,email,role]of productionIdentities){const matches=users.filter(u=>u.name===name&&u.id===expectedIds[name]&&u.role===role);ensure(matches.length===1,'Исходные User IDs или роли не совпадают');ensure(matches[0].email.endsWith('@demo.local'),'Начальный логин уже изменён; требуется проверка');if(role==='PARTNER')ensure(await tx.partner.count({where:{userId:matches[0].id,name}})===1,'Нарушена связь партнера');}
 const actor=expectedIds['Собир Сафаев'];const output=[];const used=new Set<string>();
 for(const [name,email,role]of productionIdentities){let password=generateInitialPassword();while(used.has(password))password=generateInitialPassword();used.add(password);const id=expectedIds[name];await tx.user.update({where:{id},data:{email,passwordHash:await hashPassword(password),demo:false,failedLogins:0,lockedUntil:null}});await tx.session.deleteMany({where:{userId:id}});await securityAudit(tx,actor,id,'LOGIN_CHANGED',{oldLogin:users.find(u=>u.id===id)!.email,newLogin:email});await securityAudit(tx,actor,id,'PASSWORD_RESET_BY_ADMIN');output.push({id,name,email,role,password});}
 await securityAudit(tx,actor,actor,'PRODUCTION_USERS_BOOTSTRAPPED');return output;
}
