import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {bootstrap,assertProductionTarget,identities,expectedTemplates} from '../scripts/seed-production.mjs';
import {executeCommand} from '../src/server/workflows';
import {initialAuditTemplates} from '../src/domain/audit-templates';
test('Production target запрещает архив/demo/test даже при production environment',()=>{for(const name of ['financemax','financemax_demo','financemax_test_123','financemax_production_fake'])assert.throws(()=>assertProductionTarget('postgresql://localhost/'+name));assert.equal(assertProductionTarget('postgresql://localhost/financemax_production').pathname,'/financemax_production');assert.throws(()=>assertProductionTarget(undefined));});
test('66 точных codes/names совпадают с каноническим каталогом',()=>{const actual=expectedTemplates();assert.equal(actual.length,66);for(const [type,rows]of Object.entries(initialAuditTemplates))for(const [code,name]of rows)assert.ok(actual.some(t=>t.projectType===type&&t.code===code&&t.name===name));});
test('Production bootstrap идемпотентен и не создаёт операционные данные',async()=>{
 const target=new URL(process.env.MIGRATION_DATABASE_URL!);assert.match(target.pathname,/^\/financemax_test_[a-f0-9]{32}$/);
 const db=new PrismaClient({datasources:{db:{url:target.toString()}}});
 try{
 const users=identities.map(([name,role])=>({id:randomUUID(),name,role,email:randomUUID()+'@example.invalid',passwordHash:'!test-unusable!',active:true}));
 await db.$transaction(tx=>bootstrap(tx,users));
 const before=await db.auditLog.count();
 await db.$transaction(tx=>bootstrap(tx,users));
 assert.equal(await db.user.count(),5);assert.equal(await db.partner.count(),2);assert.equal(await db.paymentCategory.count(),5);assert.equal(await db.expenseCategory.count(),2);assert.equal(await db.ledgerAccount.count(),4);assert.equal(await db.auditSectionTemplate.count(),66);assert.equal(await db.auditLog.count(),before);assert.equal(before,11);
 for(const count of await Promise.all([db.season.count(),db.project.count(),db.employee.count(),db.workEntry.count(),db.session.count(),db.complexityLevel.count(),db.complexityRate.count(),db.cashOutMethod.count(),db.journalTransaction.count(),db.allocationRun.count()]))assert.equal(count,0);
 assert.equal(await db.user.count({where:{demo:true}}),0);
  assert.equal((await db.ledgerAccount.findFirstOrThrow({where:{name:'Вознаграждения'}})).kind,'COMPENSATION');
 const principal={id:users[0].id,role:'ADMIN_MANAGEMENT' as const};
 await executeCommand(principal,{operation:'season',requestId:randomUUID(),data:{name:'Изолированная проверка bootstrap',startDate:'2027-01-01',endDate:'2027-12-31'}});
 await executeCommand(principal,{operation:'employee',requestId:randomUUID(),data:{name:'Только disposable сценарий'}});
 assert.equal(await db.season.count(),1);assert.equal(await db.employee.count(),1);
 }finally{await db.$disconnect();}
});


