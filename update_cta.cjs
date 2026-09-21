const fs = require('fs');
const path = require('path');

const dir = 'src/components/bangalore';

const heroPath = path.join(dir, 'BangaloreHero.astro');
let heroContent = fs.readFileSync(heroPath, 'utf8');
heroContent = heroContent.replace(/bg-\[#25D366\] hover:bg-\[#1DA851\] text-slate-900/g, 'bg-indigo-600 hover:bg-indigo-700 text-white');
heroContent = heroContent.replace(/shadow-\[0_8px_30px_rgba\(37,211,102,0\.4\)\]/g, 'shadow-[0_8px_30px_rgba(79,70,229,0.3)]');
fs.writeFileSync(heroPath, heroContent);

const monthlyPath = path.join(dir, 'MonthlyService.astro');
let monthlyContent = fs.readFileSync(monthlyPath, 'utf8');
monthlyContent = monthlyContent.replace(/bg-\[#25D366\] hover:bg-\[#1DA851\] text-slate-900/g, 'bg-indigo-600 hover:bg-indigo-700 text-white');
// Wait, Monthly is bg-blue-600, indigo-600 on blue-600 might not contrast well. Let's make the Monthly button bg-white text-indigo-600.
monthlyContent = monthlyContent.replace(/bg-indigo-600 hover:bg-indigo-700 text-white/g, 'bg-white hover:bg-slate-50 text-indigo-600');
fs.writeFileSync(monthlyPath, monthlyContent);

const faqPath = path.join(dir, 'CommonQuestions.astro');
let faqContent = fs.readFileSync(faqPath, 'utf8');
faqContent = faqContent.replace(/bg-\[#25D366\] hover:bg-\[#1DA851\] text-slate-900/g, 'bg-indigo-600 hover:bg-indigo-700 text-white');
fs.writeFileSync(faqPath, faqContent);

const formPath = path.join(dir, 'FreeCheckForm.astro');
let formContent = fs.readFileSync(formPath, 'utf8');
formContent = formContent.replace(/bg-\[#25D366\] hover:bg-\[#1DA851\] text-slate-900/g, 'bg-indigo-600 hover:bg-indigo-700 text-white');
fs.writeFileSync(formPath, formContent);

console.log('Done');
