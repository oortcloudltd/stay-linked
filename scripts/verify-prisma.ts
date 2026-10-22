import { prisma } from "../lib/prisma.js";

async function main() {
  await prisma.user.findFirst();
  console.log("✅ Connected");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
