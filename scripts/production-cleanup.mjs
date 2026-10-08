import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { assertDryRun, classify, protectedNames, isProtected } from "./production-safety.mjs";
assertDryRun(process.argv.slice(2));
const db = new PrismaClient({ datasources: { db: { url: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL } } });
const quote = (s) => '"' + s.replaceAll('"', '""') + '"';
try {
 const result = await db.$transaction(async (tx) => {
  await tx.$executeRawUnsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
  const tables = await tx.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const fks = await tx.$queryRawUnsafe(`SELECT c.conname AS name, a.relname AS child, b.relname AS parent,
   ARRAY(SELECT attname FROM pg_attribute WHERE attrelid=c.conrelid AND attnum=ANY(c.conkey) ORDER BY array_position(c.conkey,attnum)) AS "childColumns",
   ARRAY(SELECT attname FROM pg_attribute WHERE attrelid=c.confrelid AND attnum=ANY(c.confkey) ORDER BY array_position(c.confkey,attnum)) AS "parentColumns"
   FROM pg_constraint c JOIN pg_class a ON a.oid=c.conrelid JOIN pg_class b ON b.oid=c.confrelid
   JOIN pg_namespace n ON n.oid=a.relnamespace WHERE c.contype='f' AND n.nspname='public'`);
  const records = [], counts = {}, fingerprints = {};
  for (const {tablename: table} of tables) {
   const columns = await tx.$queryRawUnsafe("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", table);
   const safe = columns.map(c => c.column_name).filter(c => !/password|token|secret|credential/i.test(c));
   const rows = await tx.$queryRawUnsafe(`SELECT ${safe.map(quote).join(',')} FROM ${quote(table)}`);
   counts[table] = rows.length;
   const [hash] = await tx.$queryRawUnsafe(`SELECT md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY id::text),'')) AS hash FROM ${quote(table)} t`);
   fingerprints[table] = hash.hash;
   records.push(...rows.map(row => ({table,row,key:`${table}:${row.id}`})));
  }
  const users = records.filter(r => r.table==='User').map(r => r.row);
  const byId = new Map();
  for (const r of records) { const group = byId.get(r.row.id) ?? []; group.push(r); byId.set(r.row.id,group); }
  const edges = [], orphanCounts = {};
  for (const fk of fks) {
   const parents = records.filter(r => r.table===fk.parent);
   for (const child of records.filter(r => r.table===fk.child)) {
    if (fk.childColumns.some(c => child.row[c]==null)) continue;
    const parent = parents.find(p => fk.childColumns.every((c,i) => String(child.row[c])===String(p.row[fk.parentColumns[i]])));
    if (parent) edges.push({from:parent.key,to:child.key,kind:'FK',field:fk.childColumns.join(',')});
    else orphanCounts[fk.name]=(orphanCounts[fk.name]??0)+1;
   }
  }
  // Полиморфные ссылки, коррекции и UUID внутри JSON. Это граф влияния, не DELETE-план.
  for (const r of records) for (const [field,value] of Object.entries(r.row)) {
   if (field==='id'||value==null) continue;
   for (const id of new Set(JSON.stringify(value).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)??[]))
    for (const parent of byId.get(id)??[])
     if (!edges.some(e => e.from===parent.key&&e.to===r.key&&e.field===field)) edges.push({from:parent.key,to:r.key,kind:'REFERENCE',field});
  }
  const inventoryTables=['User','Employee','Partner','Project','Season','LedgerAccount','CashOutMethod','CashOutMethodRate','CashReconciliation','JournalTransaction','PaymentCategory','ExpenseCategory','ComplexityLevel','ComplexityRate','AuditSectionTemplate'];
  const inventory=records.filter(r => inventoryTables.includes(r.table)).map(({table,row,key}) => {
   const user=users.find(u => u.id===row.userId)??(table==='User'?row:undefined);
   const employeeIds=records.filter(r => r.table==='Employee'&&(r.row.id===row.id||r.row.userId===row.id)).map(r => r.row.id);
   const works=records.filter(r => r.table==='WorkEntry'&&employeeIds.includes(r.row.employeeId));
   const projects=new Set([...works.map(r => r.row.projectId),...records.filter(r => r.table==='ProjectAssignment'&&employeeIds.includes(r.row.employeeId)).map(r => r.row.projectId)]);
   return {key,table,id:row.id,name:row.name??row.code??'(без названия)',login:user?.email??'—',role:user?.role??'—',workEntries:works.length,projects:projects.size,payments:records.filter(r => r.table==='EmployeePayment'&&employeeIds.includes(r.row.employeeId)).length,source:row.demo||user?.demo?'User.demo=true; сопоставить с scripts/seed.ts':'Происхождение не доказано',...classify(table,row,users)};
  });
  const dependencies=inventory.filter(r => r.group==='REMOVE CANDIDATE').map(candidate => {
   const seen=new Set([candidate.key]),queue=[candidate.key];
   while(queue.length) { const key=queue.shift(); for(const e of edges.filter(e => e.from===key)) if(!seen.has(e.to)){seen.add(e.to);queue.push(e.to);} }
   const impacted=records.filter(r => seen.has(r.key)),counts={};
   for(const r of impacted) counts[r.table]=(counts[r.table]??0)+1;
   return {root:candidate.key,counts,records:impacted.map(r => r.key),externalReferences:edges.filter(e => seen.has(e.to)&&!seen.has(e.from)),protectedRecords:impacted.filter(r => isProtected(r.row.name)||isProtected(users.find(u => u.id===r.row.userId)?.name)).map(r => r.key)};
  });
  return {generatedAt:new Date().toISOString(),mode:'READ ONLY / NO DATA WAS DELETED',counts,fingerprints,foreignKeys:fks,orphanCounts,inventory,dependencies,referenceEdges:edges,protectedMatches:protectedNames.map(name => ({name,matches:users.filter(u => u.name.trim().toLowerCase()===name.toLowerCase()).map(u => u.id)}))};
 },{timeout:120000});
 mkdirSync('.runtime',{recursive:true});
 writeFileSync('.runtime/production-cleanup-dry-run.json',JSON.stringify(result,null,2));
 const lines=['## Инвентаризация текущей базы',`Снимок: ${result.generatedAt}. REPEATABLE READ READ ONLY.`,'NO DATA WAS DELETED',''];
 const esc=v => String(v??'—').replaceAll('|','\\|').replace(/[\r\n]/g,' ');
 for(const group of ['KEEP','REMOVE CANDIDATE','REVIEW REQUIRED']) {
  lines.push(`### ${group}`,'','| Таблица / ID | Имя | Логин / роль | Работы / проекты / выплаты | Источник и причина |','|---|---|---|---|---|');
  for(const r of result.inventory.filter(r => r.group===group)) lines.push(`| ${r.key} | ${esc(r.name)} | ${esc(r.login)} / ${r.role} | ${r.workEntries} / ${r.projects} / ${r.payments} | ${esc(r.source)}. ${r.reason} |`);
  lines.push('');
 }
 lines.push('### Зависимые строки по каждому кандидату','','Счётчики пересекаются, их нельзя суммировать. Включены FK и UUID-ссылки в JSON. Внешние, защищённые и audit/security связи требуют решения руководства.','');
 for(const d of result.dependencies) lines.push(`- ${d.root}: ${Object.entries(d.counts).map(([t,n])=>`${t}=${n}`).join(', ')}. Внешних связей: ${d.externalReferences.length}; защищённых строк: ${d.protectedRecords.length}.`);
 lines.push('','### Все таблицы','',...Object.entries(result.counts).map(([t,n])=>`- ${t}: ${n}`),'',`FK: ${result.foreignKeys.length}; нарушенных FK: ${Object.keys(result.orphanCounts).length}. Подробный граф: .runtime/production-cleanup-dry-run.json.`,'','### Обязательные люди','',...result.protectedMatches.map(p=>`- ${p.name}: найдено ${p.matches.length}; ${p.matches.length===1?'существующая запись сохранена':'ТРЕБУЕТ РУЧНОЙ ПРОВЕРКИ'}.`));
 writeFileSync('.runtime/production-cleanup-inventory.md',lines.join('\n'));
 console.log(JSON.stringify({tables:Object.keys(result.counts).length,rows:Object.values(result.counts).reduce((a,b)=>a+b,0),groups:Object.fromEntries(['KEEP','REMOVE CANDIDATE','REVIEW REQUIRED'].map(g=>[g,result.inventory.filter(r=>r.group===g).length])),foreignKeys:result.foreignKeys.length,orphanConstraints:Object.keys(result.orphanCounts).length,protectedMatches:result.protectedMatches.map(p=>p.matches.length),result:'NO DATA WAS DELETED'}));
} catch (error) {console.error({code:error.code, type:error.name, databaseCode:error.meta?.code});console.error('Read-only инвентаризация не завершена. Проверьте подключение и схему; секреты не выводятся.');process.exitCode=1;}
finally {await db.$disconnect();}


