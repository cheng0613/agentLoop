const fs = require("fs");
const p = "src/App.jsx";
const lines = fs.readFileSync(p, "utf8").split("\n");

// 1-based 行号定位（见调用前的 awk 输出）
const startIdx = lines.findIndex((l, i) => i >= 1440 && l.includes("{sidebarPresence.mounted ? ("));
if (startIdx < 0) {
  console.error("start not found");
  process.exit(1);
}
// 结束行：紧随其后的 `) : null}`，且是 aside 闭合之后的那一行
let endIdx = -1;
for (let i = startIdx + 1; i < lines.length; i++) {
  if (lines[i].trim() === "}) : null}" || lines[i].trim() === ") : null}") {
    endIdx = i;
    break;
  }
}
if (endIdx < 0) {
  console.error("end not found");
  process.exit(1);
}
console.log("removing lines", startIdx + 1, "to", endIdx + 1);
console.log("first:", lines[startIdx]);
console.log("last:", lines[endIdx]);

const removed = lines.splice(startIdx, endIdx - startIdx + 1);
console.log("removed", removed.length, "lines");
fs.writeFileSync(p, lines.join("\n"));
