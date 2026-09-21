const fs = require('fs');
const path = require('path');

const dir = 'src/components/bangalore';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.astro'));

files.forEach(file => {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Tone down shadows
  content = content.replace(/shadow-\[8px_8px_0px_0px_rgba\(15,23,42,1\)\]/g, 'shadow-xl');
  content = content.replace(/shadow-\[4px_4px_0px_0px_rgba\(15,23,42,1\)\]/g, 'shadow-lg');
  content = content.replace(/shadow-\[4px_4px_0px_0px_rgba\(255,255,255,0\.3\)\]/g, 'shadow-md');
  content = content.replace(/shadow-\[2px_2px_0px_0px_rgba\(15,23,42,1\)\]/g, 'shadow-md');
  content = content.replace(/shadow-\[2px_2px_0px_0px_rgba\(255,255,255,0\.2\)\]/g, 'shadow-md');

  // Tone down thick borders (if they haven't been replaced by the above)
  content = content.replace(/border-4 border-slate-900/g, 'border border-slate-200');
  content = content.replace(/border-2 border-slate-900/g, 'border border-slate-300');
  content = content.replace(/border-y-4 border-slate-900/g, 'border-y border-slate-200');
  
  // Remove playful rotations from content blocks
  content = content.replace(/transform -rotate-1/g, '');
  content = content.replace(/transform rotate-1/g, '');

  // Tone down doodles in BangaloreHero
  if (file === 'BangaloreHero.astro') {
    content = content.replace(/stroke="#0f172a"/g, 'stroke="rgba(15, 23, 42, 0.15)"');
    content = content.replace(/stroke-width="2\.5"/g, 'stroke-width="1.5"');
  }

  // Ensure no duplicate border classes
  content = content.replace(/border border-slate-200 border border-slate-200/g, 'border border-slate-200');
  content = content.replace(/border border-slate-300 border border-slate-300/g, 'border border-slate-300');

  fs.writeFileSync(filePath, content);
  console.log('Updated ' + file);
});
