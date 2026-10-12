import { copyFileSync } from "node:fs";
// Serve the PDF worker unchanged, without development-server module injection.
copyFileSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "public/pdf.worker.min.mjs");
copyFileSync("node_modules/pdfjs-dist/LICENSE", "public/pdfjs.LICENSE");
