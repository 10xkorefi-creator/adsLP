import { removeBackground } from '@imgly/background-removal-node';
import fs from 'fs';

async function processImage(inputPath, outputPath) {
    try {
        console.log(`Processing: ${inputPath}`);
        const blob = await removeBackground(inputPath);
        const buffer = Buffer.from(await blob.arrayBuffer());
        fs.writeFileSync(outputPath, buffer);
        console.log(`Saved: ${outputPath}`);
    } catch (e) {
        console.error(`Failed to process ${inputPath}:`, e);
    }
}

async function run() {
    const images = [
        {
            in: 'file:///C:/Users/Wasif.Kareem/.gemini/antigravity-ide/brain/3721fd31-56ed-4f3c-be1a-997511eef8cc/hero_waist_up_1786457616383.png',
            out: 'c:/Users/Wasif.Kareem/tally-lp/public/stressed-accountant.png'
        },
        {
            in: 'file:///C:/Users/Wasif.Kareem/.gemini/antigravity-ide/brain/3721fd31-56ed-4f3c-be1a-997511eef8cc/happy_accountant_standalone_1786456765507.png',
            out: 'c:/Users/Wasif.Kareem/tally-lp/public/happy-accountant.png'
        }
    ];

    for (const img of images) {
        await processImage(img.in, img.out);
    }
}

run();
