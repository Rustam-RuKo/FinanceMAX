import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {db} from '../src/server/db';
import {hashPassword,verifyPassword,login,authenticate,logout} from '../src/server/auth';
import {bootstrapProductionUsers,productionIdentities} from '../src/server/production-users';
import {manageUser,validatePassword} from '../src/server/user-management';
import {readResource} from '../src/server/queries';
import {readFileSync} from 'node:fs';
test('production identities/passwords/admin management/session/audit',async()=>{
 const url=new URL(process.env.MIGRATION_DATABASE_URL!);assert.match(url.pathname,/^\/financemax_test_[a-f0-9]{32}$/);const owner=new PrismaClient({datasources:{db:{url:url.toString()}}});
 try{
 const ids:Record<string,string>={};for(const [name,email,role]of productionIdentities){const u=await owner.user.create({data:{name,email:email.replace('financemax.local','demo.local'),role,demo:true,passwordHash:await hashPassword('Initial-Test-Password!')}});ids[name]=u.id;if(role==='PARTNER')await owner.partner.create({data:{name,userId:u.id,createdBy:ids['Собир Сафаев']}});}
 const before=await owner.partner.findMany({select:{id:true,userId:true}});const creds=await owner.$transaction(tx=>bootstrapProductionUsers(tx,ids));assert.equal(creds.length,5);assert.equal(new Set(creds.map(x=>x.password)).size,5);
 for(const c of creds){const row=await owner.user.findUniqueOrThrow({where:{id:c.id}});assert.equal(row.id,ids[c.name]);assert.equal(row.email,c.email);assert.equal(row.demo,false);assert.ok(c.password.length>=16&&/[A-Z]/.test(c.password)&&/[a-z]/.test(c.password)&&/\d/.test(c.password)&&/[^a-z\d]/i.test(c.password));assert.ok(await verifyPassword(c.password,row.passwordHash));assert.notEqual(c.password,row.passwordHash);}
 assert.deepEqual(await owner.partner.findMany({select:{id:true,userId:true}}),before);await assert.rejects(owner.$transaction(tx=>bootstrapProductionUsers(tx,ids)),/уже выполнен/);
 const admin={id:ids['Собир Сафаев'],role:'ADMIN_MANAGEMENT' as const};const password='Employee-Test-Password!';
 const created=await manageUser(admin,'user',{name:'Только тест',email:'new@test.local',role:'EMPLOYEE',password,confirmPassword:password});assert.equal(await db.employee.count({where:{userId:created.id}}),1);
 await assert.rejects(manageUser(admin,'user',{name:'Дубль',email:'NEW@test.local',role:'EMPLOYEE',password,confirmPassword:password}),/логин уже/);
 const partner={id:ids['Карина Григорьянц'],role:'PARTNER' as const};await assert.rejects(manageUser(partner,'user',{}));await assert.rejects(manageUser({id:created.id,role:'EMPLOYEE'},'user',{}));await assert.rejects(readResource(partner,'users',new URLSearchParams()));
 const oldSession=await login('new@test.local',password);await authenticate(oldSession);const next='Changed-Test-Password!';await manageUser(admin,'user-password',{id:created.id,password:next,confirmPassword:next});await assert.rejects(authenticate(oldSession));await assert.rejects(login('new@test.local',password));const fresh=await login('new@test.local',next);await authenticate(fresh);
 await manageUser(admin,'user-update',{id:created.id,email:'new@test.local',role:'EMPLOYEE',active:false});await assert.rejects(authenticate(fresh));await assert.rejects(login('new@test.local',next));
 await manageUser(admin,'user-update',{id:created.id,email:'renamed@test.local',role:'EMPLOYEE',active:true});const token=await login('renamed@test.local',next);await logout(token);
 await assert.rejects(manageUser(admin,'user-update',{id:partner.id,email:'karina@financemax.local',role:'EMPLOYEE',active:true}),/связанного партнера/);
 for(const name of ['Атабек Нурматов','Катерина']){const row=await db.user.findUniqueOrThrow({where:{id:ids[name]}});await manageUser(admin,'user-update',{id:row.id,email:row.email,role:row.role,active:false});}
 await assert.rejects(manageUser(admin,'user-update',{id:admin.id,email:'sobir@financemax.local',role:'EMPLOYEE',active:true}),/последнего руководителя/);
 const audits=JSON.stringify(await owner.auditLog.findMany());for(const secret of [...creds.map(c=>c.password),password,next])assert.ok(!audits.includes(secret));assert.ok(!/passwordHash|confirmPassword|scrypt:/.test(audits));assert.ok(audits.includes('PASSWORD_RESET_BY_ADMIN'));assert.ok(readFileSync('.gitignore','utf8').split(/\r?\n/).includes('.runtime/'));
 assert.throws(()=>validatePassword('','', 'user@test.local'));assert.throws(()=>validatePassword('abcdefghij','different','user@test.local'));assert.throws(()=>validatePassword('user@test.local','user@test.local','user@test.local'));validatePassword('1234567890','1234567890','user@test.local');
 }finally{await owner.$disconnect();await db.$disconnect();}
});
