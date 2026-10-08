import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
export const identities = [
 ['Собир Сафаев','ADMIN_MANAGEMENT'],['Атабек Нурматов','ADMIN_MANAGEMENT'],['Катерина','ADMIN_MANAGEMENT'],['Карина Григорьянц','PARTNER'],['Акилбек Ишев','PARTNER'],
];
export function assertProductionTarget(value) {
 let url; try { url=new URL(value); } catch { throw Error('Укажите PRODUCTION_DATABASE_URL явно'); }
 if(!['postgres:','postgresql:'].includes(url.protocol)||decodeURIComponent(url.pathname)!=='/financemax_production')throw Error('Bootstrap разрешён только для financemax_production');
 return url;
}
export function expectedTemplates(){
 const sql=readFileSync(new URL('../prisma/migrations/202610070012_audit_sections/migration.sql',import.meta.url),'utf8');
 const rows=[...sql.matchAll(/VALUES\(gen_random_uuid\(\),'(INDUSTRIAL|INTERNATIONAL)','((?:[^']|'')*)','((?:[^']|'')*)',(\d+)\);/g)].map(m=>({projectType:m[1],code:m[2].replaceAll("''","'"),name:m[3].replaceAll("''","'"),sortOrder:Number(m[4])}));
 if(rows.length!==66)throw Error('Не удалось проверить 66 утверждённых шаблонов');return rows;
}
export async function bootstrap(tx, sourceUsers){
 await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(7310926)');
 const users=[];
 for(const [name,role] of identities){
  const sources=sourceUsers.filter(u=>u.name===name&&u.role===role);
  if(sources.length!==1)throw Error('Неоднозначная исходная учётная запись: '+name);
  const source=sources[0];
  const matches=await tx.user.findMany({where:{OR:[{id:source.id},{name},{email:source.email}]}});
  if(matches.length){if(matches.length!==1||matches[0].id!==source.id||matches[0].name!==name||matches[0].role!==role||matches[0].demo)throw Error('Конфликт production identity: '+name);users.push(matches[0]);}
  else users.push(await tx.user.create({data:{id:source.id,name,email:source.email,passwordHash:source.passwordHash,role,demo:false,active:source.active}}));
 }
 const actor=users[0].id;
 async function ensure(model,name,values){const found=await tx[model].findMany({where:{name}});if(found.length>1)throw Error('Дубли справочника: '+name);if(found.length){for(const [key,value]of Object.entries(values))if(found[0][key]!==value)throw Error('Конфликт справочника: '+name);return;}await tx[model].create({data:{name,...values,createdBy:actor}});}
 for(const user of users.filter(u=>u.role==='PARTNER'))await ensure('partner',user.name,{userId:user.id,archived:false});
 for(const [name,kind,relevant]of [['Фиксированная зарплата','SALARY',true],['Квартальный бонус','BONUS',true],['Возмещение командировки','REIMBURSEMENT',false],['Сезонная выплата','FINAL',true],['Дополнительная премия','OTHER',true]])await ensure('paymentCategory',name,{kind,settlementRelevant:relevant});
 for(const name of ['Операционные расходы','Командировки'])await ensure('expenseCategory',name,{active:true});
 for(const [name,kind]of [['Начальные остатки','OPENING'],['Доходы','REVENUE'],['Вознаграждения','COMPENSATION'],['Расходы','EXPENSE']])await ensure('ledgerAccount',name,{kind,currency:'UZS',active:true,archived:false});
 const templates=await tx.auditSectionTemplate.findMany();
 const expected=expectedTemplates();
 if(templates.length!==66||expected.some(e=>!templates.some(t=>t.projectType===e.projectType&&t.code===e.code&&t.name===e.name&&t.sortOrder===e.sortOrder&&t.active)))throw Error('Содержимое шаблонов отличается от утверждённой миграции');
 return {users:users.length,partners:2,templates:templates.length};
}
export async function runSeed(){
 const target=assertProductionTarget(process.env.PRODUCTION_DATABASE_URL);
 const sourceUrl=new URL(process.env.PRODUCTION_SOURCE_DATABASE_URL??'');
 if(sourceUrl.pathname!=='/financemax'||sourceUrl.hostname!==target.hostname||sourceUrl.port!==target.port)throw Error('Укажите исходную архивную financemax того же сервера явно');
 const source=new PrismaClient({datasources:{db:{url:sourceUrl.toString()}}});
 const targetDb=new PrismaClient({datasources:{db:{url:target.toString()}}});
 try{
  const sourceUsers=await source.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');return tx.user.findMany({where:{name:{in:identities.map(x=>x[0])}},select:{id:true,name:true,email:true,passwordHash:true,role:true,active:true}});});
  const result=await targetDb.$transaction(async tx=>{
   const [actual]=await tx.$queryRawUnsafe('SELECT current_database() AS name');if(actual.name!=='financemax_production')throw Error('Неверная фактическая база');
   const tables=await tx.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public'");
   const allowed=new Set(['_prisma_migrations','User','Partner','AuditSectionTemplate','PaymentCategory','ExpenseCategory','LedgerAccount','AuditLog']);
   for(const {tablename:t}of tables)if(!allowed.has(t)){const [n]=await tx.$queryRawUnsafe('SELECT count(*)::int AS n FROM "'+t.replaceAll('"','""')+'"');if(n.n)throw Error('База содержит операционные данные: '+t);}
   if(await tx.user.count({where:{OR:[{demo:true},{name:{notIn:identities.map(x=>x[0])}}]}}))throw Error('В базе посторонние/demo пользователи');
      const referenceNames={partner:['Карина Григорьянц','Акилбек Ишев'],paymentCategory:['Фиксированная зарплата','Квартальный бонус','Возмещение командировки','Сезонная выплата','Дополнительная премия'],expenseCategory:['Операционные расходы','Командировки'],ledgerAccount:['Начальные остатки','Доходы','Вознаграждения','Расходы']};
   for(const [model,names]of Object.entries(referenceNames))if(await tx[model].count({where:{name:{notIn:names}}}))throw Error('Неутверждённый справочник в production');
      const models={Partner:'partner',PaymentCategory:'paymentCategory',LedgerAccount:'ledgerAccount'};
   for(const audit of await tx.auditLog.findMany()) {
    const model=models[audit.entity];
    if(!model||audit.operation!=='INSERT'||audit.oldValue!==null||!sourceUsers.some(u=>u.id===audit.createdBy)||!await tx[model].findUnique({where:{id:audit.entityId}}))throw Error('Неизвестная история аудита; bootstrap запрещён');
   }
   return bootstrap(tx,sourceUsers);
  },{isolationLevel:'Serializable',timeout:30000});
  console.log(JSON.stringify({status:'Production bootstrap завершён',...result}));
 }finally{await source.$disconnect();await targetDb.$disconnect();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)runSeed().catch(()=>{console.error('Production seed отклонён: проверьте явные URL, чистоту базы и справочники. Секреты не выводятся.');process.exitCode=1;});



