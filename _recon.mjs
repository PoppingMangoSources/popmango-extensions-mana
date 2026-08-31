import { readFileSync } from "node:fs";
import * as cheerio from "cheerio";
const html = readFileSync("/root/.claude/uploads/c07f9c28-9c46-5c8f-b936-f485ad160467/02c07ad0-mangagooo.txt", "utf8");
console.log("bytes:", html.length);
console.log("viewport/mobile markers:", /uk-h4|uikit/i.test(html) ? "uikit (desktop theme)" : "?");
const $ = cheerio.load(html);
// Top-level containers that hold a list of tiles = candidate home rows.
$("[id]").each((_, el) => {
  const node = $(el);
  const tiles = node.find(".updatesli, .pic_list li, li.pic, .listitem").length;
  if (tiles < 3) return;
  console.log(`#${node.attr("id")} .${node.attr("class") ?? ""} -> ${tiles} tiles`);
});
