const fs = require('fs');
const path = require('path');
const dir = 'src/components/bangalore';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.astro'));
for (const file of files) {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(/rounded-\[2rem\]/g, 'rounded-md');
  content = content.replace(/rounded-3xl/g, 'rounded-md');
  content = content.replace(/rounded-2xl/g, 'rounded-md');
  content = content.replace(/rounded-xl/g, 'rounded');
  fs.writeFileSync(filePath, content);
}
console.log('Updated corner radii');
