// migrate-wp-posts.mjs
//
// Migra i post esportati con `npx wordpress-export-to-markdown`
// Struttura di partenza:
//   output/posts/nomepost.md       <- un file .md per post, direttamente nella cartella
//   output/posts/images/img01.jpg  <- tutte le immagini in un'unica cartella condivisa
//
// Struttura di destinazione (Astro content collection):
//   src/content/blog/nomepost.md
//   src/assets/blog/images/img01.jpg   <- immagini copiate una sola volta, riferimenti aggiornati
//
// Uso:
//   npm install gray-matter
//   node migrate-wp-posts.mjs
//
// Modifica le costanti qui sotto se i tuoi path sono diversi.

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const SOURCE_POSTS_DIR = path.resolve("./output/posts");
const SOURCE_IMAGES_DIR = path.join(SOURCE_POSTS_DIR, "images");
const DEST_CONTENT_DIR = path.resolve("./src/content/blog");
const DEST_IMAGES_DIR = path.resolve("./src/assets/blog/images");

function makeDescription(body, maxLen = 160) {
  const plain = body
    .replace(/!\[[^\]]*]\([^)]*\)/g, "") // rimuove immagini markdown
    .replace(/<[^>]+>/g, "") // rimuove eventuali tag html
    .replace(/[#*_>`]/g, "") // rimuove marcatori markdown comuni
    .replace(/\s+/g, " ")
    .trim();

  if (plain.length <= maxLen) return plain;
  return plain.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
}

function copyAllImages() {
  if (!fs.existsSync(SOURCE_IMAGES_DIR)) {
    console.warn(`⚠️  Nessuna cartella immagini trovata in ${SOURCE_IMAGES_DIR}, salto.`);
    return;
  }
  fs.mkdirSync(DEST_IMAGES_DIR, { recursive: true });
  const files = fs.readdirSync(SOURCE_IMAGES_DIR);
  for (const file of files) {
    fs.copyFileSync(
      path.join(SOURCE_IMAGES_DIR, file),
      path.join(DEST_IMAGES_DIR, file)
    );
  }
  console.log(`Copiate ${files.length} immagini in ${DEST_IMAGES_DIR}\n`);
}

function fixImagePaths(content) {
  // Sostituisce qualsiasi riferimento a "images/nomefile.ext" (con o senza ./ davanti)
  // con il path relativo corretto per Astro: ../../assets/blog/images/nomefile.ext
  return content.replace(
    /(!\[[^\]]*]\()(?:\.?\/)?images\/([^)]+)(\))/g,
    "$1../../assets/blog/images/$2$3"
  );
}

const VALID_HERO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"];

function extractFirstImage(content) {
  const matches = content.matchAll(/!\[[^\]]*]\(([^)]+)\)/g);
  for (const match of matches) {
    const imgPath = match[1];
    const ext = path.extname(imgPath).toLowerCase();
    if (VALID_HERO_EXTENSIONS.includes(ext)) {
      return imgPath;
    }
  }
  return undefined;
}

// `coverImage` arriva dal campo "featured image" di WordPress: il tool di export
// lo mette in frontmatter come semplice nome file (es. "foto.jpg"), separato dal
// testo del post. Lo ricostruiamo come path verso la cartella immagini condivisa.
function buildHeroFromCover(coverImage) {
  if (!coverImage) return undefined;
  const filename = path.basename(coverImage);
  const ext = path.extname(filename).toLowerCase();
  if (!VALID_HERO_EXTENSIONS.includes(ext)) return undefined;
  return `../../assets/blog/images/${filename}`;
}

function migratePost(filename) {
  const slug = filename.replace(/\.md$/, "");
  const srcPath = path.join(SOURCE_POSTS_DIR, filename);

  const raw = fs.readFileSync(srcPath, "utf-8");
  const { data, content } = matter(raw);

  const updatedContent = fixImagePaths(content);

  const newData = {
    title: data.title ?? slug,
    description: data.description ?? makeDescription(content),
    pubDate: data.pubDate ?? data.date ?? new Date().toISOString().slice(0, 10),
    tags: data.tags ?? data.categories ?? [],
    // Ordine: heroImage esplicita > coverImage (featured image WP) > prima immagine nel testo
    heroImage:
      data.heroImage ??
      buildHeroFromCover(data.coverImage) ??
      extractFirstImage(updatedContent),
  };

  if (!newData.heroImage) delete newData.heroImage; // niente campo vuoto se non c'è nessuna immagine

  fs.mkdirSync(DEST_CONTENT_DIR, { recursive: true });
  const outPath = path.join(DEST_CONTENT_DIR, `${slug}.md`);
  const finalFile = matter.stringify(updatedContent, newData);
  fs.writeFileSync(outPath, finalFile, "utf-8");

  console.log(`✅ ${slug} -> ${outPath}`);
}

function run() {
  if (!fs.existsSync(SOURCE_POSTS_DIR)) {
    console.error(`❌ Cartella non trovata: ${SOURCE_POSTS_DIR}`);
    console.error("   Esegui lo script dalla root del progetto Astro,");
    console.error("   o modifica SOURCE_POSTS_DIR in testa al file.");
    process.exit(1);
  }

  const mdFiles = fs
    .readdirSync(SOURCE_POSTS_DIR)
    .filter((f) => f.endsWith(".md"));

  if (mdFiles.length === 0) {
    console.error(`❌ Nessun file .md trovato in ${SOURCE_POSTS_DIR}`);
    process.exit(1);
  }

  console.log(`Trovati ${mdFiles.length} post da migrare...\n`);

  copyAllImages();

  for (const file of mdFiles) {
    migratePost(file);
  }

  console.log("\nFatto. Controlla src/content/blog/ e src/assets/blog/images/ prima del commit.");
}

run();
