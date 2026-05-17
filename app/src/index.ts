import { main } from "./server";

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
