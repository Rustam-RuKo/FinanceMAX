import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
const excluded=new Set(['node_modules','.next','.git','.runtime']);
const findings=[],largeFiles=[],files=[];
function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory()){if(!excluded.has(entry.name))walk(path);}else{const size=statSync(path).size;if(size>5_000_000)largeFiles.push({path:relative('.',path),bytes:size});if(size<5_000_000&&(/\.(?:[cm]?[jt]sx?|json|md|sql|ps1|ya?ml|toml|txt|example)$/.test(path)||entry.name.startsWith('.env')))files.push(path);}}}
walk('.');
const patterns=[['PostgreSQL URL с паролем',/postgres(?:ql)?:\/\/[^\s:@]+:([^\s@]+)@/i],['API key',/\bsk-[A-Za-z0-9_-]{16,}/],['Private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['Literal password/token/secret',/(?:password|пароль|secret|token|api_key)\s*[=:]\s*["'`]([^"'`\r\n]{8,})["'`]/i],['Известный тестовый пароль',/(?:Scenario-password|[A-Za-z]+-password)-\d+/i]];
for(const path of files){const lines=readFileSync(path,'utf8').split(/\r?\n/);lines.forEach((line,i)=>{for(const [type,re] of patterns)if(re.test(line))findings.push({path:relative('.',path),line:i+1,type,value:'***',classification:/^(tests|scripts)[\\/]/.test(path)?'Проверить: тестовый литерал или выражение':'Проверить вручную'});});}
mkdirSync('.runtime',{recursive:true});
writeFileSync('.runtime/secret-scan.json',JSON.stringify({filesScanned:files.length,excluded:[...excluded],findings,largeFiles,limitations:'Эвристический scan текущих текстовых файлов; исключённые каталоги могут содержать секреты и полностью запрещены к публикации. История проверяется отдельно.'},null,2));
console.log(JSON.stringify({filesScanned:files.length,findings,largeFiles},null,2));
