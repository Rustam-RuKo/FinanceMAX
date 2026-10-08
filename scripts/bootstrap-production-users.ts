import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { readFileSync, existsSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';
import { bootstrapProductionUsers } from '../src/server/production-users';
const target=process.env.PRODUCTION_DATABASE_URL;
if(!target||new URL(target).pathname!=='/financemax_production')throw Error('Укажите PRODUCTION_DATABASE_URL для financemax_production');
const db=new PrismaClient({datasources:{db:{url:target}}});
const output='.runtime/production-initial-credentials.txt';
try{
 const [current]=await db.$queryRawUnsafe<{name:string}[]>('SELECT current_database() AS name');if(current.name!=='financemax_production')throw Error('Неверная база');
 if(await db.auditLog.findFirst({where:{operation:'PRODUCTION_USERS_BOOTSTRAPPED'}})){console.log('Production user bootstrap уже выполнен.');process.exitCode=1;}
 else{
  if(existsSync(output))throw Error('Файл credentials уже существует; автоматическая перезапись запрещена');
  if(!readFileSync('.gitignore','utf8').split(/\r?\n/).includes('.runtime/'))throw Error('.runtime должна быть исключена из Git');
  const manifest=JSON.parse(readFileSync('.runtime/production-bootstrap-evidence.json','utf8'));
  const expected=Object.fromEntries(manifest.users.map((u:{name:string;id:string})=>[u.name,u.id]));
  mkdirSync('.runtime',{recursive:true});
  await db.$transaction(async tx=>{
   const credentials=await bootstrapProductionUsers(tx,expected);
   const fd=openSync(output,'wx',0o600);
   try{writeFileSync(fd,'КОНФИДЕНЦИАЛЬНО. Первоначальные пароли; передать лично. Не публиковать.\n\n'+credentials.map(u=>`${u.name}\nЛогин: ${u.email}\nПароль: ${u.password}\nРоль: ${u.role==='ADMIN_MANAGEMENT'?'Руководство':'Партнер'}\n`).join('\n'));fsyncSync(fd);}finally{closeSync(fd);}
  },{isolationLevel:'Serializable',timeout:30000});
  console.log('Production user bootstrap: COMPLETE. Credentials file: '+output);
 }
}catch{console.error('Bootstrap отклонён/не подтверждён. Проверьте базу, manifest и credentials-файл. Не повторяйте генерацию до сверки маркера; значения секретов не выводятся.');process.exitCode=1;}finally{await db.$disconnect();}
