import { runAgent } from "./agent.js";

const request = process.argv.slice(2).join(" ").trim();
if (!request) {
  console.error('Usage: npm run agent -- "צור מדריך מעוצב + דף נחיתה לקורס אפייה ביתית"');
  process.exit(1);
}

try {
  console.log(await runAgent(request));
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
